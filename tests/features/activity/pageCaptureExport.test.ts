/**
 * 真实页面录制导出测试（pageCaptureExport）。
 *
 * jsdom 环境限制：无录屏 API、无 canvas 2d 上下文、video 无内在尺寸，这些能力统一用
 * stub 注入——本文件校验的是模块自己的链路：裁框计算、会话生命周期、成片产出与幂等。
 * 真正的录屏行为只能人工在浏览器里验证（headless 下 getDisplayMedia 恒不可用）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canCaptureTab,
  cropSourceOf,
  EXPORT_FRAME_SELECTOR,
  requestTabCaptureStream,
  startPageCapture,
} from '@/features/activity/pageCaptureExport'

/** 构造 N 个点的假轨迹不需要——本模块不接触轨迹，只处理画面。 */

/** 视频元素的假尺寸（jsdom 下 videoWidth 恒为 0，需显式注入） */
function stubVideoSize(width: number, height: number): void {
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => width,
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => height,
  })
}

/** 注入视口宽度（jsdom 无布局，clientWidth 恒为 0） */
function stubViewportWidth(width: number): void {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: width,
  })
}

/**
 * 在 DOM 里放一个录制画框，并给它一个固定矩形。
 *
 * @param rect 画框矩形（CSS 像素）
 * @returns 画框元素
 */
function mountExportFrame(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const frame = document.createElement('div')
  frame.className = EXPORT_FRAME_SELECTOR.slice(1)
  frame.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect
  document.body.append(frame)
  return frame
}

/**
 * 构造假媒体流：只实现本模块用到的方法。
 *
 * @returns 假流（含一个可手动触发的 video track）
 */
function makeFakeStream(): { stream: MediaStream; stopped: () => number; endTrack: () => void } {
  let stoppedCount = 0
  const listeners: (() => void)[] = []
  const track = {
    stop: () => {
      stoppedCount += 1
    },
    addEventListener: (_type: string, listener: () => void) => {
      listeners.push(listener)
    },
  }
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
  return {
    stream,
    stopped: () => stoppedCount,
    endTrack: () => {
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

/**
 * 注入最小可用的 MediaRecorder / canvas 2D / captureStream 实现。
 *
 * @returns 断言用的记录器（录制器实例、是否已 start/stop、drawImage 源矩形）
 */
function stubRecorderEnvironment(): {
  instances: { started: boolean; stopped: boolean }[]
  drawImageArgs: unknown[][]
  chunks: Blob[]
} {
  const instances: { started: boolean; stopped: boolean }[] = []
  const drawImageArgs: unknown[][] = []
  const chunks: Blob[] = []

  class FakeMediaRecorder {
    static isTypeSupported = (mime: string) => mime.startsWith('video/mp4')
    state = 'inactive'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    private readonly record: { started: boolean; stopped: boolean }

    constructor() {
      this.record = { started: false, stopped: false }
      instances.push(this.record)
    }

    start(): void {
      this.state = 'recording'
      this.record.started = true
      // 立刻给一片数据：模拟浏览器周期性 dataavailable
      chunks.push(new Blob(['video'], { type: 'video/mp4' }))
      this.ondataavailable?.({ data: chunks[chunks.length - 1]! })
    }

    stop(): void {
      this.state = 'inactive'
      this.record.stopped = true
      this.onstop?.()
    }
  }

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  // jsdom 没有 captureStream，只能 defineProperty 补上（spyOn 要求属性已存在）
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    value: () => new EventTarget() as unknown as MediaStream,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: (...args: unknown[]) => {
      drawImageArgs.push(args)
    },
    // 字幕绘制用到的属性与调用：全部 no-op 即可
    set font(_value: string) {},
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillText: () => undefined,
    strokeText: () => undefined,
    measureText: () => ({ width: 10 }) as TextMetrics,
    save: () => undefined,
    restore: () => undefined,
  } as unknown as CanvasRenderingContext2D)

  return { instances, drawImageArgs, chunks }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const frame of document.querySelectorAll(EXPORT_FRAME_SELECTOR)) {
    frame.remove()
  }
})

describe('可录制性判定', () => {
  it('jsdom 无 getDisplayMedia：判定为不可录制，且取流直接返回 undefined', async () => {
    expect(canCaptureTab()).toBe(false)
    await expect(requestTabCaptureStream()).resolves.toBeUndefined()
  })

  it('有 getDisplayMedia 且用户授权时返回视频流', async () => {
    const stream = { id: 'fake' } as unknown as MediaStream
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })

    expect(canCaptureTab()).toBe(true)
    await expect(requestTabCaptureStream()).resolves.toBe(stream)
    // 必须带上「优先当前标签页」约束，否则用户拿到的选择器会默认选错目标
    expect(getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({ preferCurrentTab: true, audio: false }),
    )
  })

  it('用户拒绝授权（抛错）时不外抛，返回 undefined 交给调用方回退', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    vi.spyOn(console, 'warn').mockReturnValue(undefined)

    await expect(requestTabCaptureStream()).resolves.toBeUndefined()
  })
})

describe('裁框计算 cropSourceOf', () => {
  it('画框存在时按「视频宽 ÷ 视口宽」换算源矩形（两侧留黑不进成片）', () => {
    stubVideoSize(2160, 3840)
    stubViewportWidth(1080)
    const video = document.createElement('video')
    mountExportFrame({ left: 300, top: 0, width: 480, height: 854 })

    const source = cropSourceOf(video, 9 / 16)

    // 缩放 2 倍：视频是 CSS 尺寸的 2 倍（devicePixelRatio = 2 的情形）
    expect(source.sx).toBe(600)
    expect(source.sy).toBe(0)
    expect(source.sw).toBe(960)
    expect(source.sh).toBe(1708)
  })

  it('画框超出画面右边界时源矩形被夹住，不会取出画面外的透明区', () => {
    stubVideoSize(1080, 1920)
    stubViewportWidth(1080)
    const video = document.createElement('video')
    mountExportFrame({ left: 700, top: 0, width: 480, height: 854 })

    const source = cropSourceOf(video, 9 / 16)

    expect(source.sx).toBe(700)
    expect(source.sw).toBe(380)
  })

  it('画框不存在时退化为整幅居中裁剪（cover）', () => {
    stubVideoSize(1920, 1080)
    stubViewportWidth(1920)
    const video = document.createElement('video')

    const source = cropSourceOf(video, 9 / 16)

    expect(source.sx).toBeCloseTo((1920 - 1080 * (9 / 16)) / 2, 3)
    expect(source.sy).toBe(0)
    expect(source.sw).toBeCloseTo(1080 * (9 / 16), 3)
    expect(source.sh).toBe(1080)
  })

  it('更窄的画面按高度居中裁剪', () => {
    stubVideoSize(1080, 1920)
    stubViewportWidth(1080)
    const video = document.createElement('video')
    // 目标比例比画面更宽：以宽度为准，裁掉上下
    const source = cropSourceOf(video, 16 / 9)

    expect(source.sx).toBe(0)
    expect(source.sw).toBe(1080)
    expect(source.sh).toBeCloseTo(1080 / (16 / 9), 3)
    expect(source.sy).toBeCloseTo((1920 - 1080 / (16 / 9)) / 2, 3)
  })

  it('视频尚无画面时返回全零（调用方据此跳过该帧绘制）', () => {
    stubVideoSize(0, 0)
    stubViewportWidth(1080)
    const video = document.createElement('video')

    expect(cropSourceOf(video, 9 / 16)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 })
  })
})

describe('录制会话', () => {
  it('不支持 MediaRecorder 时返回 undefined（调用方回退自绘）', async () => {
    stubVideoSize(1080, 1920)
    const stream = makeFakeStream().stream
    vi.stubGlobal('MediaRecorder', undefined)

    await expect(
      startPageCapture(stream, { captions: {}, maxSeconds: 30 }),
    ).resolves.toBeUndefined()
  })

  it('全链路：按画框裁切合成 → 产出 mp4 成片 → 释放流，且 finish 幂等', async () => {
    // 视频是 CSS 尺寸的 2 倍（devicePixelRatio = 2），画框居中偏左
    stubVideoSize(2160, 3840)
    stubViewportWidth(1080)
    mountExportFrame({ left: 40, top: 0, width: 500, height: 889 })
    const env = stubRecorderEnvironment()
    const fake = makeFakeStream()

    const session = await startPageCapture(fake.stream, {
      captions: { hook: ['钩子'], dataLine: ['数据行'] },
      maxSeconds: 30,
    })
    expect(session).toBeDefined()

    await session!.ready
    const first = await session!.finish()
    const second = await session!.finish()

    expect(env.instances[0]?.started).toBe(true)
    expect(env.instances[0]?.stopped).toBe(true)
    expect(first?.extension).toBe('mp4')
    expect(first?.mimeType).toMatch(/^video\/mp4/)
    expect(first?.blob.size).toBeGreaterThan(0)
    // 幂等：重复收尾返回同一个 Promise，不会二次停止录制器
    expect(second).toBe(first)
    // 流必须被释放，否则浏览器一直显示「正在共享」
    expect(fake.stopped()).toBe(1)
    // 合成画布只取画框区域（缩放 2 倍后 80 → 1080），窗口两侧留黑不进成片
    expect(env.drawImageArgs[0]?.[1]).toBe(80)
    expect(env.drawImageArgs[0]?.[3]).toBe(1000)
    expect(env.drawImageArgs[0]?.[5]).toBe(0)
    expect(env.drawImageArgs[0]?.[7]).toBe(1080)
  }, 20000)

  it('用户在浏览器里点「停止共享」时自动收尾，页面随后能拿到成片', async () => {
    stubVideoSize(1080, 1920)
    stubViewportWidth(1080)
    mountExportFrame({ left: 0, top: 0, width: 1080, height: 1920 })
    stubRecorderEnvironment()
    const fake = makeFakeStream()

    const session = await startPageCapture(fake.stream, { captions: {}, maxSeconds: 30 })
    expect(session).toBeDefined()

    fake.endTrack()
    const result = await session!.finish()

    expect(result?.extension).toBe('mp4')
  }, 20000)
})
