/**
 * 真实界面分享卡出图层测试（shareStageCapture）。
 *
 * 三条不变量在这里把关：
 * - 出图参数必须按 1080×1440 / 2 倍图导出，且必须清掉预览缩放（transform: none），
 *   否则成片会是缩在角落的一张小卡；
 * - 瓦片就绪等待按「计数连续不变」判定，一张瓦片都没出现时也不无限等；
 * - 快照库抛错（jsdom、旧浏览器）时返回 undefined，绝不把异常抛给弹窗。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest'
import { domToBlob, type Options } from 'modern-screenshot'
import {
  captureShareStagePng,
  downloadShareStagePng,
  shareStageFileName,
  waitForStageTiles,
} from '@/features/share/shareStageCapture'

vi.mock('modern-screenshot', () => ({
  domToBlob: vi.fn(),
}))

// domToBlob 有 (node, options) 与 (context) 两个重载，这里按前者取类型，方便断言出图参数
const domToBlobMock = domToBlob as unknown as MockedFunction<
  (node: Node, options?: Options) => Promise<Blob>
>

/**
 * 造一个带 n 张「已加载」瓦片的舞台节点。
 *
 * @param loadedTiles 已加载瓦片数
 */
function makeStage(loadedTiles: number): HTMLElement {
  const stage = document.createElement('div')
  for (let index = 0; index < loadedTiles; index += 1) {
    const tile = document.createElement('img')
    tile.className = 'leaflet-tile leaflet-tile-loaded'
    stage.appendChild(tile)
  }
  return stage
}

/** 造一个「有地图但瓦片一张都没加载出来」的舞台节点（离线场景） */
function makeStageWithPendingTiles(): HTMLElement {
  const stage = document.createElement('div')
  const tile = document.createElement('img')
  tile.className = 'leaflet-tile'
  stage.appendChild(tile)
  return stage
}

describe('shareStageCapture 真实界面出图', () => {
  beforeEach(() => {
    domToBlobMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('文件名含日期；套图页另带页标签', () => {
    expect(shareStageFileName('2026-09-06')).toBe('骑了么-2026-09-06-真实界面.png')
    expect(shareStageFileName('2026-09-06', '封面')).toBe('骑了么-2026-09-06-真实界面-封面.png')
  })

  it('没有地图的页立即放行（套图逐页出图不为无地图的页白等）', async () => {
    const stage = makeStage(0)

    // 不放行的话这里会等到兜底等待（>1s）；立即 resolve 说明短路生效
    await expect(waitForStageTiles(stage, 5000)).resolves.toBeUndefined()
  })

  it('瓦片计数稳定即放行（不等满上限）', async () => {
    vi.useFakeTimers()
    const stage = makeStage(3)

    const waiting = waitForStageTiles(stage, 5000)
    await vi.advanceTimersByTimeAsync(1000)

    await expect(waiting).resolves.toBeUndefined()
  })

  it('有地图但瓦片始终加载不出时，走到兜底等待后放行（离线不阻断出图）', async () => {
    vi.useFakeTimers()
    const stage = makeStageWithPendingTiles()

    const waiting = waitForStageTiles(stage, 400)
    await vi.advanceTimersByTimeAsync(3000)

    await expect(waiting).resolves.toBeUndefined()
  })

  it('按 1080×1440 / 2 倍图导出，并清掉预览缩放', async () => {
    domToBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const stage = makeStage(1)

    const blob = await captureShareStagePng(stage)

    expect(blob?.size).toBe(3)
    expect(domToBlobMock).toHaveBeenCalledTimes(1)
    const [node, options] = domToBlobMock.mock.calls[0]!
    expect(node).toBe(stage)
    expect(options?.width).toBe(1080)
    expect(options?.height).toBe(1440)
    expect(options?.scale).toBe(2)
    expect(options?.style?.transform).toBe('none')
  })

  it('快照库抛错时返回 undefined（调用方降级，不抛给 UI）', async () => {
    domToBlobMock.mockRejectedValue(new Error('canvas unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(captureShareStagePng(makeStage(1))).resolves.toBeUndefined()

    warn.mockRestore()
  })

  it('空 Blob 视为失败（不下载空文件）', async () => {
    domToBlobMock.mockResolvedValue(new Blob([]))

    await expect(captureShareStagePng(makeStage(1))).resolves.toBeUndefined()
  })

  it('下载走 Blob URL 且文件名正确（套图带页标签）', () => {
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = vi.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    let downloaded = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = this.download
    })

    downloadShareStagePng(new Blob(['x']), '2026-09-06')
    expect(downloaded).toBe('骑了么-2026-09-06-真实界面.png')

    downloadShareStagePng(new Blob(['x']), '2026-09-06', '洞察')
    expect(downloaded).toBe('骑了么-2026-09-06-真实界面-洞察.png')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    click.mockRestore()
  })
})
