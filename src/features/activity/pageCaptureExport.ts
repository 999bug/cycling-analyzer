/**
 * 真实页面录制导出：把「在线回放」的**真实地图画面**录成竖屏短视频。
 *
 * 与 canvas 自绘版（trackVideoExport.ts）的分工：
 * - 本模块录**真实标签页**——真实 Leaflet 渲染、真实缩放/署名控件、真实回放控制栏，
 *   观感与录屏工具产出一致（用户诉求：与 replay-video-record 技能输出一致）；
 * - 自绘版零依赖、零授权，浏览器不支持录屏或用户拒绝授权时兜底（见页面里的回退分支）。
 *
 * 三条硬约束（都是实测得出，改前先读）：
 * 1. `getDisplayMedia` 必须在**用户手势**里调用，且 `requestFullscreen` 同样消耗手势，
 *    两者不能在同一手势里连续调用。所以本项目**不用 Fullscreen API**，改用 CSS 录制舞台
 *    （`EXPORT_STAGE_CLASS`）：页面侧先把地图变成居中竖屏画框，再去取流。
 * 2. 录到的是**整个标签页**（含浏览器窗口的宽高比，未必竖屏），故成片只取
 *    「录制画框」区域（`EXPORT_FRAME_SELECTOR`），画框两侧的留黑不进成片。
 *    画框矩形每帧现取，窗口尺寸变化也能跟着走。
 * 3. 底图瓦片必须加载稳定后再开播，否则片头是空白地图。做法与录屏技能一致：
 *    轮询 `.leaflet-tile-loaded` 数量，稳定若干次即认为就绪。
 */
import {
  canvasLayoutOf,
  DEFAULT_VIDEO_ASPECT_RATIO,
  drawVideoCaptions,
  pickVideoMimeType,
  type TrackVideoExportResult,
  type VideoAspectRatio,
  type VideoCaptionTexts,
} from '@/features/activity/trackVideoExport'

/** 录制画框选择器：ActivityMap 在录制态给地图容器加该类（成片只取这块区域） */
export const EXPORT_FRAME_SELECTOR = '.map-export-frame'

/** 录制帧率（与自绘版一致） */
const CAPTURE_FPS = 30

/** 码率（与自绘版一致：6 Mbps） */
const CAPTURE_BITRATE = 6_000_000

/** 等首帧出现的上限（毫秒）：超时按失败处理，避免录出全黑 */
const FIRST_FRAME_TIMEOUT_MS = 5000

/** 瓦片稳定判定：轮询间隔 / 连续相同次数 / 总上限（毫秒） */
const TILE_POLL_INTERVAL_MS = 400
const TILE_STABLE_HITS = 3
const TILE_WAIT_MAX_MS = 12_000

/** 取不到瓦片计数时的兜底等待（毫秒；jsdom 等无瓦片环境） */
const TILE_WAIT_FALLBACK_MS = 1500

/** 开播前保留的静止画面（毫秒）：与录屏技能成片的 1 秒片头一致 */
const LEAD_IN_MS = 1000

/** 播放结束后的收尾静止帧（毫秒，与录屏技能成片的 0.8 秒片尾一致） */
const TAIL_MS = 800

/** 硬超时余量（秒）：目标时长之外再等该值即强制结束，避免录屏失控 */
const MAX_EXTRA_SECONDS = 20

/** 单次 dataavailable 分片时长（毫秒） */
const CHUNK_TIMESLICE_MS = 1000

/**
 * `getDisplayMedia` 的标签页捕获扩展参数。
 *
 * TS 的 lib.dom 未必带上这三个字段（`preferCurrentTab` 等为 Chromium 扩展），
 * 故在此显式声明，避免依赖编辑器类型版本。
 */
interface TabCaptureConstraints extends DisplayMediaStreamOptions {
  /** 优先选中当前标签页（Chrome 会给出简化选择器） */
  preferCurrentTab?: boolean

  /** 允许把当前标签页列入可共享范围 */
  selfBrowserSurface?: 'include' | 'exclude'

  /** 录制期间是否允许切换共享目标 */
  surfaceSwitching?: 'include' | 'exclude'
}

/** 录制会话选项 */
export interface PageCaptureOptions {
  /** 字幕文本（钩子 + 数据行；与自绘版共用同一套字号与描边规则） */
  captions: VideoCaptionTexts

  /** 画布比例（缺省 9:16 竖屏） */
  aspectRatio?: VideoAspectRatio

  /** 录制上限（秒）：回放未正常结束时的硬超时基准 */
  maxSeconds: number
}

/**
 * 录制会话：由页面驱动（取流 → 进录制舞台 → 开录 → 开播 → 结束取片）。
 */
export interface PageCaptureSession {
  /** 画面就绪并已进入录制（含片头静止画面）后 resolve，此时可以开始播放回放 */
  ready: Promise<void>

  /**
   * 结束录制并产出成片。
   *
   * 幂等：重复调用返回同一个 Promise；用户中途点浏览器的「停止共享」或触发硬超时
   * 也会自动收尾，此时页面再调一次即拿到结果。
   */
  finish: () => Promise<TrackVideoExportResult | undefined>

  /** 放弃录制：停止录制器与媒体流，不产出成片 */
  dispose: () => void
}

/**
 * 当前环境是否支持录制标签页。
 *
 * 注意 headless 浏览器里 `getDisplayMedia` 恒为 undefined（无头模式禁用录屏 API），
 * 因此这个函数在自动化测试里会返回 false，属预期行为。
 */
export function canCaptureTab(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  )
}

/**
 * 请求录制当前标签页（**必须在用户手势中调用**）。
 *
 * 用户拒绝授权、取消选择器或环境不支持时返回 undefined，由调用方回退自绘方案。
 *
 * @returns 屏幕（标签页）视频流；未授予时 undefined
 */
export async function requestTabCaptureStream(): Promise<MediaStream | undefined> {
  if (!canCaptureTab()) {
    return undefined
  }
  try {
    const constraints: TabCaptureConstraints = {
      video: { frameRate: CAPTURE_FPS },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    }
    return await navigator.mediaDevices.getDisplayMedia(constraints)
  } catch (err: unknown) {
    // NotAllowedError = 用户点了取消/拒绝，属正常分支，不打 error 日志
    console.warn('Tab capture request was not granted', err)
    return undefined
  }
}

/**
 * 睡眠（毫秒）。
 *
 * @param ms 毫秒
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 等视频元素出首帧：优先 `requestVideoFrameCallback`，无该 API 时轮询 `readyState`。
 *
 * @param video 承载标签页流的视频元素
 * @param timeoutMs 超时（毫秒）
 * @returns 是否在超时前拿到画面
 */
async function waitForFirstFrame(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  const hasFrame = () => video.videoWidth > 0 && video.videoHeight > 0
  if (hasFrame()) {
    return true
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(100)
    if (hasFrame()) {
      return true
    }
  }
  return false
}

/**
 * 等底图瓦片加载稳定：轮询录制画框内的 `.leaflet-tile-loaded` 数量，连续几次不变即就绪。
 *
 * 与录屏技能同策略——固定 sleep 在长距离轨迹上不够（缩放级别大、瓦片多），
 * 而等待稳定又不会白等。
 *
 * @param maxMs 最长等待（毫秒）
 */
async function waitForTilesSettled(maxMs: number): Promise<void> {
  if (typeof document === 'undefined') {
    return
  }
  const deadline = Date.now() + maxMs
  let previous = -1
  let stableHits = 0
  let sawTile = false
  while (Date.now() < deadline) {
    await sleep(TILE_POLL_INTERVAL_MS)
    const frame = document.querySelector(EXPORT_FRAME_SELECTOR)
    const count = frame === null ? 0 : frame.querySelectorAll('.leaflet-tile-loaded').length
    if (count > 0) {
      sawTile = true
    }
    if (count === previous) {
      stableHits += 1
      if (stableHits >= TILE_STABLE_HITS) {
        return
      }
    } else {
      stableHits = 0
    }
    previous = count
  }
  // 一张瓦片都没见到（测试环境/瓦片源全挂）：不额外补偿，交给调用方的超时兜底
  if (!sawTile) {
    await sleep(TILE_WAIT_FALLBACK_MS)
  }
}

/**
 * 计算「从录到的标签页画面里裁出录制画框」的源矩形（视频像素）。
 *
 * 画框在页面里是居中的竖屏容器，窗口未必竖屏，两侧留黑不能进成片。
 * 缩放比例用「视频宽 ÷ 视口 CSS 宽」现算，兼容设备像素比与浏览器缩放；
 * 画框取不到时（如被卸载）退化为整幅居中裁剪（cover），保证不画出画面外的透明区。
 *
 * @param video 承载标签页流的视频元素
 * @param targetRatio 目标画布宽高比（退化路径用）
 */
export function cropSourceOf(
  video: HTMLVideoElement,
  targetRatio: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const videoWidth = Math.max(video.videoWidth, 0)
  const videoHeight = Math.max(video.videoHeight, 0)
  if (videoWidth === 0 || videoHeight === 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 }
  }

  const frame = typeof document === 'undefined' ? null : document.querySelector(EXPORT_FRAME_SELECTOR)
  const viewWidth = typeof document === 'undefined' ? 0 : document.documentElement.clientWidth
  if (frame !== null && viewWidth > 0) {
    const rect = frame.getBoundingClientRect()
    if (rect.width > 1 && rect.height > 1) {
      const scale = videoWidth / viewWidth
      const sx = Math.min(Math.max(rect.left * scale, 0), videoWidth - 2)
      const sy = Math.min(Math.max(rect.top * scale, 0), videoHeight - 2)
      const sw = Math.min(rect.width * scale, videoWidth - sx)
      const sh = Math.min(rect.height * scale, videoHeight - sy)
      if (sw > 1 && sh > 1) {
        return { sx, sy, sw, sh }
      }
    }
  }

  // 退化：整幅居中裁剪到目标比例
  const videoRatio = videoWidth / videoHeight
  if (videoRatio > targetRatio) {
    const sw = videoHeight * targetRatio
    return { sx: (videoWidth - sw) / 2, sy: 0, sw, sh: videoHeight }
  }
  const sh = videoWidth / targetRatio
  return { sx: 0, sy: (videoHeight - sh) / 2, sw: videoWidth, sh }
}

/**
 * 开始录制：把标签页画面裁到录制画框、叠加字幕，并用 MediaRecorder 编码。
 *
 * 调用前请确保录制舞台（画框）已挂载——瓦片稳定判定依赖它。
 *
 * @param stream 标签页视频流（由 {@link requestTabCaptureStream} 取得）
 * @param options 字幕与时长选项
 * @returns 录制会话；环境不支持或缺 2D 上下文时 undefined
 */
export async function startPageCapture(
  stream: MediaStream,
  options: PageCaptureOptions,
): Promise<PageCaptureSession | undefined> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    return undefined
  }
  const mimeType = pickVideoMimeType()
  if (mimeType === undefined) {
    return undefined
  }
  const layout = canvasLayoutOf(options.aspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO)
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return undefined
  }

  // 标签页流灌进离屏 video：画面不进 DOM，只作合成源
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  // jsdom 等环境下 play() 返回 undefined（未实现），不能直接 .catch
  const played = video.play() as Promise<void> | undefined
  if (played !== undefined) {
    await played.catch(() => undefined)
  }
  const hasFrame = await waitForFirstFrame(video, FIRST_FRAME_TIMEOUT_MS)
  if (!hasFrame) {
    for (const track of stream.getTracks()) {
      track.stop()
    }
    return undefined
  }

  // 瓦片稳定后再开录：避免片头是空白地图
  await waitForTilesSettled(TILE_WAIT_MAX_MS)

  const recorder = new MediaRecorder(canvas.captureStream(CAPTURE_FPS), {
    mimeType,
    videoBitsPerSecond: CAPTURE_BITRATE,
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }
  const recorderStopped = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      resolve()
    }
  })

  const startedAt = performance.now()
  let rafId = 0
  // 画布合成循环：裁剪画框 → 叠字幕（钩子前 4 秒 + 底部数据行）
  const drawFrame = () => {
    const source = cropSourceOf(video, layout.width / layout.height)
    if (source.sw > 0 && source.sh > 0) {
      ctx.drawImage(
        video,
        source.sx,
        source.sy,
        source.sw,
        source.sh,
        0,
        0,
        layout.width,
        layout.height,
      )
    }
    drawVideoCaptions(ctx, layout, options.captions, (performance.now() - startedAt) / 1000)
    rafId = requestAnimationFrame(drawFrame)
  }

  let finished = false
  let resultPromise: Promise<TrackVideoExportResult | undefined> | undefined
  // 硬超时句柄：回放异常未结束时兜底收尾。用常量盒子承载——
  // finish/dispose 需要清除它，而它们定义在定时器之前，直接引用 let 变量会踩声明顺序
  const guardBox: { id: ReturnType<typeof setTimeout> | undefined } = { id: undefined }

  /** 释放媒体资源：停合成循环、停录制器、停流（幂等） */
  const release = () => {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }

  const finish = (): Promise<TrackVideoExportResult | undefined> => {
    if (resultPromise !== undefined) {
      return resultPromise
    }
    finished = true
    if (guardBox.id !== undefined) {
      clearTimeout(guardBox.id)
      guardBox.id = undefined
    }
    resultPromise = (async () => {
      // 片尾静止帧：先停合成循环让最后一帧定格，再停录制器
      if (rafId !== 0) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      await sleep(TAIL_MS)
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }
      await recorderStopped
      release()
      const blob = new Blob(chunks, { type: mimeType })
      if (blob.size === 0) {
        return undefined
      }
      return { blob, mimeType, extension: mimeType.includes('mp4') ? 'mp4' : 'webm' }
    })()
    return resultPromise
  }

  const dispose = () => {
    if (finished) {
      return
    }
    finished = true
    if (guardBox.id !== undefined) {
      clearTimeout(guardBox.id)
      guardBox.id = undefined
    }
    release()
  }

  // 用户在浏览器「正在共享」提示条上点停止：自动收尾（页面随后会拿到成片）
  const videoTrack = stream.getVideoTracks()[0]
  videoTrack?.addEventListener('ended', () => {
    if (!finished) {
      void finish()
    }
  })
  // 硬超时：回放异常未结束也不能一直录
  guardBox.id = setTimeout(
    () => {
      if (!finished) {
        void finish()
      }
    },
    (options.maxSeconds + MAX_EXTRA_SECONDS) * 1000,
  )

  recorder.start(CHUNK_TIMESLICE_MS)
  drawFrame()

  const ready = sleep(LEAD_IN_MS)
  return { ready, finish, dispose }
}
