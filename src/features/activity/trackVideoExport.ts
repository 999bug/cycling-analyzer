/**
 * 轨迹回放视频导出（规格外：用户需求）。
 *
 * 与在线回放同款视觉：真实地图（合规底图：高德栅格瓦片）为底图，整条轨迹暗灰线，
 * 已走部分橙色高亮推进，当前位置青色光标 + 光晕 + 实时数据牌（速度/心率/功率，
 * 缺失字段省略不伪造），位置在记录点间线性插值平滑移动；左上角 HUD 展示活动名
 * 与已骑行距离/时长，右下角底图版权署名；可选开头钩子与底部数据行字幕。
 *
 * 时间轴与在线回放同一口径：按「运动时间」推进（折叠红灯/休息等暂停时段，
 * 见 buildMovingTimeline），HUD 时长展示的也是运动时长，不会出现光标长时间静止的画段。
 *
 * 坐标系：底图恒为高德（GCJ-02），因此轨迹必须先经 `@/geo/projection` 的
 * projectPoints 投影，否则整条轨迹会整体偏移（页面地图同样如此）。
 *
 * 技术路线：Canvas 2D 逐帧绘制 → canvas.captureStream() → MediaRecorder 录制。
 * 浏览器优先选择 video/mp4 编码（Chrome 126+/Safari 原生支持），不支持时降级
 * video/webm 并保留 .webm 后缀。地图瓦片以 crossOrigin=anonymous 加载（高德返回
 * `Access-Control-Allow-Origin: *`，画布不被污染，captureStream 可用）；瓦片加载失败
 * （离线/超时/成功率过低）自动降级为暗色网格示意底图——导出永不因网络失败。
 * 无外部依赖，作者源只读活动同样可导出。
 */
import type { ActivityRecord, TrackOffset } from '@/types/activity'
import type { CoordinateSystem } from '@/geo/coordinateSystem'
import { projectPoint, type ProjectOptions } from '@/geo/projection'
import { buildMovingTimeline, formatCursorTipItems } from '@/map/replayCore'
import { loadStoredMapMode, mapModeOf, TILE_SOURCES, type MapMode, type MapModeLayer } from '@/map/tileSources'

/** 视频帧率（fps）：MediaRecorder 时间片对齐用 */
const VIDEO_FPS = 30

/** 默认画布比例：竖屏（适配短视频平台） */
export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16'

/** 默认视频时长（秒） */
export const DEFAULT_VIDEO_DURATION_SECONDS = 30

/** 视频编码码率（bps）：1080p 竖屏观感与体积的折中 */
const VIDEO_BITRATE = 6_000_000

/** 画布比例（宽:高） */
export type VideoAspectRatio = '9:16' | '1:1' | '16:9'

/** 各比例的画布尺寸：短边统一 1080，保证三种比例观感与体积一致 */
export const VIDEO_ASPECT_SIZES: Record<VideoAspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
}

/** 安全边距占画布短边的比例（1080 短边 → 80px） */
const PADDING_RATIO = 0.074

/**
 * 画布布局：尺寸 + 由短边换算的安全边距。
 * 三种比例短边同为 1080，故视觉比例一致；边距按短边而非宽高写死，
 * 避免竖屏下 HUD/轨迹贴边出血。
 */
export interface CanvasLayout {
  /** 画布宽（像素） */
  width: number

  /** 画布高（像素） */
  height: number

  /** 安全边距（像素） */
  padding: number

  /** 短边长度（像素，字号换算基准） */
  shortSide: number
}

/**
 * 按比例取画布布局。
 *
 * @param ratio 画布比例
 */
export function canvasLayoutOf(ratio: VideoAspectRatio): CanvasLayout {
  const size = VIDEO_ASPECT_SIZES[ratio] ?? VIDEO_ASPECT_SIZES[DEFAULT_VIDEO_ASPECT_RATIO]
  const shortSide = Math.min(size.width, size.height)
  return {
    width: size.width,
    height: size.height,
    padding: Math.round(shortSide * PADDING_RATIO),
    shortSide,
  }
}

/** 已走高亮线颜色（与在线回放 TRAVELED_COLOR 一致） */
const TRAVELED_COLOR = '#ff9f43'

/** 当前位置光标颜色（与在线回放 CURSOR_COLOR 一致） */
const CURSOR_COLOR = '#34d9ff'

/** 全程轨迹底色（未走部分，地图上清晰可见的暗灰） */
const TRAIL_BASE_COLOR = 'rgba(58, 64, 74, 0.92)'

/** 轨迹外衬边颜色（浅色地图瓦片上的对比描边） */
const TRAIL_CASING_COLOR = 'rgba(255, 255, 255, 0.85)'

/** 降级示意底图背景色（深空黑） */
const BACKGROUND_COLOR = '#0d1117'

/** 地图瓦片尺寸（标准 Web Mercator 瓦片边长，像素） */
const TILE_SIZE = 256

/** 地图底图加载单张瓦片超时（毫秒）：超时按失败计 */
const MAP_BACKDROP_TIMEOUT_MS = 5000

/** 地图底图（索引 0 底图层）最低成功率：低于该值则放弃地图模式 */
const MAP_BACKDROP_MIN_SUCCESS_RATIO = 0.7

/** 拟合缩放的上下限（Web Mercator 瓦片金字塔范围） */
const MAP_ZOOM_MIN = 2
const MAP_ZOOM_MAX = 17

/** HUD 文字颜色 */
const HUD_TEXT_COLOR = '#e6edf3'

/** HUD 标签颜色（弱化灰） */
const HUD_LABEL_COLOR = '#9aa4b2'

/** 字幕/文字统一字族：必须显式指定中文字族，否则中文渲染成方框 */
const HUD_FONT_FAMILY = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'

/** 开头钩子字幕展示时长（秒） */
const HOOK_DURATION_SECONDS = 4

/** 字幕描边宽度占字号比例（浅色瓦片上也能看清） */
const CAPTION_STROKE_RATIO = 0.14

/** 底图版权署名（高德栅格瓦片；去 HTML 标签与实体后供 canvas 纯文本绘制） */
const MAP_ATTRIBUTION_TEXT = TILE_SOURCES[0]!.attribution
  .replace(/<[^>]*>/g, '')
  .replace(/&copy;/g, '©')

/** 视频底图选择：「跟随当前」= 读用户记忆的地图模式 */
export type VideoMapModeChoice = 'follow' | MapMode

/** 「跟随里程」自适应时长：约每 5 km 计 1 秒 */
const DISTANCE_KM_PER_SECOND = 5

/** 自适应时长区间（秒） */
const DURATION_MIN_SECONDS = 15
const DURATION_MAX_SECONDS = 60

/** 面板中的时长选项（秒数字符串 + 跟随里程） */
export type VideoDurationChoice = '15' | '30' | '60' | 'distance'

/**
 * 「跟随里程」自适应时长：约每 5 km 对 1 秒，夹在 15~60 秒区间。
 * 里程缺失时回退默认时长（不伪造）。
 *
 * @param distanceMeters 总里程（米）
 */
export function distanceBasedDurationSeconds(distanceMeters: number | undefined): number {
  if (distanceMeters === undefined || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return DEFAULT_VIDEO_DURATION_SECONDS
  }
  const seconds = Math.round(distanceMeters / 1000 / DISTANCE_KM_PER_SECOND)
  return Math.min(Math.max(seconds, DURATION_MIN_SECONDS), DURATION_MAX_SECONDS)
}

/**
 * 面板时长选项 → 实际秒数。
 *
 * @param choice 时长选项
 * @param distanceMeters 总里程（米，仅「跟随里程」用到）
 */
export function resolveVideoDuration(
  choice: VideoDurationChoice,
  distanceMeters: number | undefined,
): number {
  if (choice === 'distance') {
    return distanceBasedDurationSeconds(distanceMeters)
  }
  const seconds = Number(choice)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_VIDEO_DURATION_SECONDS
}

/**
 * 回放视频导出结果。
 */
export interface TrackVideoExportResult {
  /** 导出文件 Blob */
  blob: Blob

  /** 实际容器格式 MIME（如 video/mp4 或 video/webm） */
  mimeType: string

  /** 推荐文件扩展名（mp4 或 webm） */
  extension: string
}

/**
 * 字幕输入：钩子与数据行都取活动真实数据，缺失即整行省略（不伪造）。
 */
export interface VideoCaptionInput {
  /** 总里程（米） */
  distanceMeters?: number

  /** 总爬升（米） */
  elevationGainMeters?: number

  /** 运动时长（秒） */
  movingSeconds?: number

  /** 视频时长（秒，用于换算「加速倍速」） */
  videoSeconds: number

  /** 是否显示开头钩子（前 4 秒） */
  showHook: boolean

  /** 是否显示底部数据行 */
  showDataLine: boolean

  /**
   * 自定义开头钩子文案（多行，每行一条字幕）。
   * 非空时**完全覆盖**自动生成（不再要求有里程数据），空串/未传则走自动生成。
   */
  hookText?: string

  /** 自定义底部数据行文案（多行，每行一条字幕）；语义同上 */
  dataLineText?: string
}

/**
 * 字幕文本（每项为一行）。
 */
export interface VideoCaptionTexts {
  /** 开头钩子（前 4 秒展示） */
  hook?: readonly string[]

  /** 底部数据行（全程展示） */
  dataLine?: readonly string[]
}

/**
 * 把自定义字幕文案拆成字幕行：按换行拆、去首尾空白、丢弃空行。
 *
 * 全为空白时返回 undefined（= 没写自定义文案，调用方回退自动生成），
 * 这样「输入框留空」与「没填过」语义一致，用户清空即可恢复自动文案。
 *
 * @param text 自定义文案（未传 = 无自定义）
 * @returns 字幕行；无有效内容时 undefined
 */
export function splitCaptionLines(text: string | undefined): readonly string[] | undefined {
  if (text === undefined) {
    return undefined
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.length > 0 ? lines : undefined
}

/**
 * 生成字幕文本（纯函数，便于单测）。
 *
 * 钩子默认：`这条 {km} 公里的回放` / `别人要开会员才能看`；
 * 数据行默认：`{km} km · 爬升 {gain} m` / `运动 {时长} · {倍速}× 加速`。
 * 传入 `hookText` / `dataLineText` 时整块替换为自定义文案（见 {@link splitCaptionLines}）。
 *
 * @param input 字幕输入
 */
export function buildVideoCaptionTexts(input: VideoCaptionInput): VideoCaptionTexts {
  const { distanceMeters, elevationGainMeters, movingSeconds, videoSeconds } = input

  const hasDistance = distanceMeters !== undefined && distanceMeters > 0
  const customHook = splitCaptionLines(input.hookText)
  let hook: readonly string[] | undefined
  if (input.showHook) {
    if (customHook !== undefined) {
      hook = customHook
    } else if (hasDistance) {
      hook = [`这条 ${(distanceMeters / 1000).toFixed(1)} 公里的回放`, '别人要开会员才能看']
    }
  }

  const customDataLine = splitCaptionLines(input.dataLineText)
  let dataLine: readonly string[] | undefined
  if (input.showDataLine) {
    if (customDataLine !== undefined) {
      dataLine = customDataLine
    } else {
      const firstRow: string[] = []
      if (hasDistance) {
        firstRow.push(`${(distanceMeters / 1000).toFixed(1)} km`)
      }
      if (elevationGainMeters !== undefined) {
        firstRow.push(`爬升 ${Math.round(elevationGainMeters)} m`)
      }
      const secondRow: string[] = []
      if (movingSeconds !== undefined && movingSeconds > 0) {
        secondRow.push(`运动 ${formatDuration(movingSeconds)}`)
        if (videoSeconds > 0) {
          secondRow.push(`${Math.max(1, Math.round(movingSeconds / videoSeconds))}× 加速`)
        }
      }
      const rows = [firstRow.join(' · '), secondRow.join(' · ')].filter((row) => row.length > 0)
      dataLine = rows.length > 0 ? rows : undefined
    }
  }

  return { hook, dataLine }
}

/**
 * 字幕选项：开关 + 数据（都取活动真实数据，缺失即整行省略，不伪造）。
 */
export interface TrackVideoCaptionOptions {
  /** 是否显示开头钩子（缺省显示） */
  hook?: boolean

  /** 是否显示底部数据行（缺省显示） */
  dataLine?: boolean

  /** 自定义开头钩子文案（多行；非空时覆盖自动生成，见 {@link buildVideoCaptionTexts}） */
  hookText?: string

  /** 自定义底部数据行文案（多行；非空时覆盖自动生成） */
  dataLineText?: string

  /** 总里程（米；缺省取轨迹末点的累计距离） */
  distanceMeters?: number

  /** 总爬升（米） */
  elevationGainMeters?: number

  /** 运动时长（秒） */
  movingSeconds?: number
}

/**
 * 视频导出选项。
 */
export interface TrackVideoExportOptions {
  /** 视频时长（秒；缺省 30 秒） */
  durationSeconds?: number

  /** 画布比例（缺省 9:16 竖屏） */
  aspectRatio?: VideoAspectRatio

  /** 底图（缺省「跟随当前」= 用户记忆的地图模式） */
  mapMode?: VideoMapModeChoice

  /** 字幕开关与数据（缺省两者都开） */
  captions?: TrackVideoCaptionOptions

  /** 轨迹原始坐标所属坐标系（纠偏用；缺省 wgs84） */
  coordinateSystem?: CoordinateSystem

  /** 轨迹手动微调量（米，归一化到 WGS-84 之后叠加） */
  trackOffset?: TrackOffset

  /** 录制进度回调（整秒节流，供面板显示「录制中 x/y 秒」） */
  onProgress?: (elapsedSeconds: number, totalSeconds: number) => void
}

/**
 * 逐帧绘制用的轨迹点：画布像素坐标 + 数据牌/HUD 所需的记录字段。
 */
interface FramePoint {
  /** Unix 秒时间戳 */
  timestamp: number

  /** 画布像素 x */
  px: number

  /** 画布像素 y */
  py: number

  /** 纬度（时间轴「光标限速」补时用，见 buildMovingTimeline） */
  latitude: number

  /** 经度（时间轴「光标限速」补时用） */
  longitude: number

  /** 累计距离（米） */
  distance?: number

  /** 速度（m/s） */
  speed?: number

  /** 心率（bpm） */
  heartRate?: number

  /** 功率（W） */
  power?: number
}

/**
 * 已合成的地图底图：瓦片绘制到离屏画布，逐帧 drawImage 即可。
 */
interface MapBackdrop {
  canvas: HTMLCanvasElement
}

/**
 * 经纬度包围盒（度）。
 */
interface LatLngBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

/**
 * 各号字体的字号（按画布短边换算，保证三种比例观感一致）。
 */
interface FontSizes {
  /** HUD 标题 */
  title: number

  /** HUD 副标题 / 光标数据牌 */
  body: number

  /** 底图署名 */
  attribution: number

  /** 开头钩子字幕 */
  hook: number

  /** 底部数据行字幕 */
  dataLine: number
}

/**
 * 从源 FIT 文件名派生回放视频文件名：去掉 .fit / .fit.gz 后缀追加 -replay.mp4。
 *
 * @param fileName 源 FIT 文件名（如 ride.fit.gz）
 * @param extension 扩展名（mp4/webm）
 * @returns 视频文件名（如 ride-replay.mp4）
 */
export function buildVideoFileName(fileName: string, extension: string): string {
  const base = fileName.replace(/\.fit(\.gz)?$/i, '')
  return `${base}-replay.${extension}`
}

/**
 * 按浏览器支持度选择 MediaRecorder 容器格式：优先 mp4（h264/aac），降级 webm。
 *
 * 自绘导出与「真实页面录制」共用（两者都要求尽量直出 MP4，平台才收）。
 *
 * @returns 支持的 MIME；两者都不支持时返回 undefined
 */
export function pickVideoMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined
  }
  const preferred = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  return preferred.find((mime) => MediaRecorder.isTypeSupported(mime))
}

/* ------------------------- Web Mercator 纯计算 ------------------------- */

/**
 * 经度 → 指定缩放级别的 Web Mercator 世界像素 x（256px 瓦片金字塔）。
 *
 * @param longitude 经度（度）
 * @param zoom 缩放级别
 */
export function lngToWorldPx(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * TILE_SIZE * 2 ** zoom
}

/**
 * 纬度 → 指定缩放级别的 Web Mercator 世界像素 y（北小南大）。
 * 纬度钳制在墨卡托有效域 ±85.0511° 内。
 *
 * @param latitude 纬度（度）
 * @param zoom 缩放级别
 */
export function latToWorldPx(latitude: number, zoom: number): number {
  const clamped = Math.min(Math.max(latitude, -85.05112878), 85.05112878)
  const latRad = (clamped * Math.PI) / 180
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2
  return y * TILE_SIZE * 2 ** zoom
}

/**
 * 计算把经纬度包围盒等比塞进画布安全区的最大整数缩放级别。
 *
 * @param bounds 经纬度包围盒
 * @param width 画布宽（像素）
 * @param height 画布高（像素）
 * @param padding 安全区边距（像素）
 * @returns 缩放级别（MAP_ZOOM_MIN ~ MAP_ZOOM_MAX）
 */
export function computeFittedZoom(
  bounds: LatLngBounds,
  width: number,
  height: number,
  padding: number,
): number {
  for (let zoom = MAP_ZOOM_MAX; zoom > MAP_ZOOM_MIN; zoom--) {
    const spanX = lngToWorldPx(bounds.maxLng, zoom) - lngToWorldPx(bounds.minLng, zoom)
    const spanY = latToWorldPx(bounds.minLat, zoom) - latToWorldPx(bounds.maxLat, zoom)
    if (spanX <= width - padding * 2 && spanY <= height - padding * 2) {
      return zoom
    }
  }
  return MAP_ZOOM_MIN
}

/**
 * 计算覆盖画布视口所需的瓦片坐标范围（越界钳制到金字塔内）。
 *
 * @param zoom 缩放级别
 * @param originX 视口左上角的世界像素 x
 * @param originY 视口左上角的世界像素 y
 * @param width 视口宽（像素）
 * @param height 视口高（像素）
 */
export function computeTileRange(
  zoom: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
): { xStart: number; xEnd: number; yStart: number; yEnd: number } {
  // 每轴瓦片数为 2^zoom（索引 0 ~ 2^zoom-1）；世界像素宽为 TILE_SIZE × 2^zoom
  const maxTileIndex = 2 ** zoom - 1
  const clampTile = (value: number) => Math.min(Math.max(value, 0), maxTileIndex)
  return {
    xStart: clampTile(Math.floor(originX / TILE_SIZE)),
    xEnd: clampTile(Math.floor((originX + width) / TILE_SIZE)),
    yStart: clampTile(Math.floor(originY / TILE_SIZE)),
    yEnd: clampTile(Math.floor((originY + height) / TILE_SIZE)),
  }
}

/**
 * 展开瓦片模板中的 {s}/{z}/{x}/{y} 占位符（子域按瓦片坐标轮询，避免单域名限流）。
 *
 * @param template 瓦片 URL 模板
 * @param subdomains 子域列表（可为空）
 * @param z zoom 层级
 * @param x 瓦片 X
 * @param y 瓦片 Y
 */
export function expandTileUrl(
  template: string,
  subdomains: readonly string[],
  z: number,
  x: number,
  y: number,
): string {
  const sub = subdomains.length > 0 ? subdomains[Math.abs(x + y) % subdomains.length]! : ''
  return template
    .replace('{s}', sub)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
}

/**
 * 解析面板的底图选择：「跟随当前」读用户记忆的地图模式，否则用所选模式。
 *
 * @param choice 底图选择
 */
export function resolveVideoMapMode(choice: VideoMapModeChoice): MapMode {
  return choice === 'follow' ? loadStoredMapMode() : choice
}

/* --------------------------- 地图底图加载 --------------------------- */

/**
 * 加载单张瓦片（匿名跨域），超时或失败时 reject。
 *
 * @param url 瓦片 URL
 */
function loadTile(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    const timer = setTimeout(() => {
      image.src = ''
      reject(new Error('tile timeout'))
    }, MAP_BACKDROP_TIMEOUT_MS)
    image.onload = () => {
      clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      clearTimeout(timer)
      reject(new Error('tile error'))
    }
    image.src = url
  })
}

/**
 * 拉取并绘制单张瓦片图层，返回成功绘制的瓦片数。
 *
 * @param ctx 底图画布上下文
 * @param layer 图层定义（URL 模板 + 子域 + 不透明度）
 * @param zoom 缩放级别
 * @param originX 视口左上角世界像素 x
 * @param originY 视口左上角世界像素 y
 * @param range 瓦片坐标范围
 */
async function drawTileLayer(
  ctx: CanvasRenderingContext2D,
  layer: MapModeLayer,
  zoom: number,
  originX: number,
  originY: number,
  range: { xStart: number; xEnd: number; yStart: number; yEnd: number },
): Promise<number> {
  const jobs: Promise<{ x: number; y: number; image: HTMLImageElement }>[] = []
  for (let ty = range.yStart; ty <= range.yEnd; ty++) {
    for (let tx = range.xStart; tx <= range.xEnd; tx++) {
      const url = expandTileUrl(layer.url, layer.subdomains, zoom, tx, ty)
      jobs.push(loadTile(url).then((image) => ({ x: tx, y: ty, image })))
    }
  }
  const results = await Promise.allSettled(jobs)
  const loaded = results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<{
        x: number
        y: number
        image: HTMLImageElement
      }> => result.status === 'fulfilled',
    )
    .map((result) => result.value)

  if (loaded.length === 0) {
    return 0
  }
  ctx.globalAlpha = layer.opacity ?? 1
  for (const tile of loaded) {
    ctx.drawImage(tile.image, tile.x * TILE_SIZE - originX, tile.y * TILE_SIZE - originY)
  }
  ctx.globalAlpha = 1
  return loaded.length
}

/**
 * 拉取底图瓦片并合成整幅地图底图离屏画布（按地图模式的图层栈顺序叠加）。
 *
 * 底图层（索引 0）成功率不足或整体超时返回 undefined（调用方降级为示意底图）；
 * 叠加层（如「卫星+路网」的透明注记）失败只跳过该层，不影响底图可用。
 *
 * @param zoom 缩放级别
 * @param originX 视口左上角世界像素 x
 * @param originY 视口左上角世界像素 y
 * @param layout 画布布局
 * @param mode 地图模式
 * @returns 合成结果；环境不支持（无 document/2d 上下文）或底图成功率过低时 undefined
 */
export async function loadMapBackdrop(
  zoom: number,
  originX: number,
  originY: number,
  layout: CanvasLayout,
  mode: MapMode,
): Promise<MapBackdrop | undefined> {
  if (typeof document === 'undefined') {
    return undefined
  }
  const range = computeTileRange(zoom, originX, originY, layout.width, layout.height)
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return undefined
  }
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, layout.width, layout.height)

  const layers = mapModeOf(mode).layers
  const tilesPerLayer =
    (range.xEnd - range.xStart + 1) * (range.yEnd - range.yStart + 1)
  // 底图层：成功率过低说明网络整体不可用，整幅地图不可用（叠加层无底可叠）
  const baseLoaded = await drawTileLayer(ctx, layers[0]!, zoom, originX, originY, range)
  if (tilesPerLayer === 0 || baseLoaded / tilesPerLayer < MAP_BACKDROP_MIN_SUCCESS_RATIO) {
    return undefined
  }
  // 叠加层：失败只跳过该层，不影响底图可用
  for (let index = 1; index < layers.length; index++) {
    await drawTileLayer(ctx, layers[index]!, zoom, originX, originY, range)
  }
  return { canvas }
}

/* --------------------------- 轨迹投影 --------------------------- */

/**
 * 提取含坐标的逐点记录，投影为画布像素坐标序列。
 *
 * 地图模式：Web Mercator 世界像素 → 以轨迹包围盒中心为画布中心平移得到。
 * 降级示意模式：等距圆柱平面坐标（米）等比缩放居中——仅保留相对形状。
 *
 * @param records 完整逐点数据（已投影到底图坐标系）
 * @param backdropZoom 地图模式缩放级别；undefined 时走示意投影
 * @param layout 画布布局
 * @returns 帧绘制点列表（timestamp 升序）；坐标点不足 2 个时返回 undefined
 */
function buildFramePoints(
  records: readonly ActivityRecord[],
  backdropZoom: number | undefined,
  layout: CanvasLayout,
): FramePoint[] | undefined {
  const coordRecords = records.filter(
    (record) => record.latitude !== undefined && record.longitude !== undefined,
  )
  if (coordRecords.length < 2) {
    return undefined
  }

  if (backdropZoom !== undefined) {
    // Web Mercator：包围盒中心对齐画布中心
    let minLat = Infinity
    let maxLat = -Infinity
    let minLng = Infinity
    let maxLng = -Infinity
    for (const record of coordRecords) {
      minLat = Math.min(minLat, record.latitude!)
      maxLat = Math.max(maxLat, record.latitude!)
      minLng = Math.min(minLng, record.longitude!)
      maxLng = Math.max(maxLng, record.longitude!)
    }
    const centerX = (lngToWorldPx(minLng, backdropZoom) + lngToWorldPx(maxLng, backdropZoom)) / 2
    const centerY = (latToWorldPx(minLat, backdropZoom) + latToWorldPx(maxLat, backdropZoom)) / 2
    return coordRecords.map((record) => ({
      timestamp: record.timestamp,
      px: lngToWorldPx(record.longitude!, backdropZoom) - centerX + layout.width / 2,
      py: latToWorldPx(record.latitude!, backdropZoom) - centerY + layout.height / 2,
      latitude: record.latitude!,
      longitude: record.longitude!,
      distance: record.distance,
      speed: record.speed,
      heartRate: record.heartRate,
      power: record.power,
    }))
  }

  // 示意投影（降级）：等距圆柱坐标等比缩放居中，y 轴翻转（北朝上）
  const meters = coordRecords.map((record) => ({
    record,
    x: record.longitude! * 111320 * Math.cos((record.latitude! * Math.PI) / 180),
    y: record.latitude! * 110540,
  }))
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of meters) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min(
    (layout.width - layout.padding * 2) / spanX,
    (layout.height - layout.padding * 2) / spanY,
  )
  const offsetX = (layout.width - spanX * scale) / 2
  const offsetY = (layout.height - spanY * scale) / 2
  return meters.map(({ record, x, y }) => ({
    timestamp: record.timestamp,
    px: offsetX + (x - minX) * scale,
    py: layout.height - offsetY - (y - minY) * scale,
    latitude: record.latitude!,
    longitude: record.longitude!,
    distance: record.distance,
    speed: record.speed,
    heartRate: record.heartRate,
    power: record.power,
  }))
}

/**
 * 目标时刻对应的帧位置与所在段右端点索引：段内线性插值（与在线回放同一平滑策略，
 * 消除记录点间隔导致的逐点跳动）。二分返回右端点，段取 [右端点-1, 右端点]。
 *
 * @param points 帧绘制点（timestamp 升序）
 * @param timestamp 目标时刻
 */
function findFramePosition(
  points: readonly FramePoint[],
  timestamp: number,
): { px: number; py: number; nextIndex: number } {
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid]!.timestamp < timestamp) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  const next = points[low]!
  const current = points[low - 1]
  if (current === undefined || next.timestamp <= current.timestamp) {
    return { px: next.px, py: next.py, nextIndex: low }
  }
  const t = Math.min(Math.max((timestamp - current.timestamp) / (next.timestamp - current.timestamp), 0), 1)
  return {
    px: current.px + (next.px - current.px) * t,
    py: current.py + (next.py - current.py) * t,
    nextIndex: low,
  }
}

/* --------------------------- 逐帧绘制 --------------------------- */

/**
 * 绘制降级示意底图：深空黑背景 + 淡网格。
 *
 * @param ctx 画布上下文
 * @param layout 画布布局
 */
function drawSchematicBackground(ctx: CanvasRenderingContext2D, layout: CanvasLayout): void {
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.lineWidth = 1
  for (let gx = 0; gx <= layout.width; gx += 64) {
    ctx.beginPath()
    ctx.moveTo(gx + 0.5, 0)
    ctx.lineTo(gx + 0.5, layout.height)
    ctx.stroke()
  }
  for (let gy = 0; gy <= layout.height; gy += 64) {
    ctx.beginPath()
    ctx.moveTo(0, gy + 0.5)
    ctx.lineTo(layout.width, gy + 0.5)
    ctx.stroke()
  }
}

/**
 * 绘制地图底图（离屏合成图）+ 半透明暗化层（提高轨迹/文字对比度）。
 *
 * @param ctx 画布上下文
 * @param backdrop 地图底图
 * @param layout 画布布局
 */
function drawMapBackground(
  ctx: CanvasRenderingContext2D,
  backdrop: MapBackdrop,
  layout: CanvasLayout,
): void {
  ctx.drawImage(backdrop.canvas, 0, 0)
  ctx.fillStyle = 'rgba(13, 17, 23, 0.22)'
  ctx.fillRect(0, 0, layout.width, layout.height)
}

/**
 * 绘制带描边的文字（浅色卫星影像与深色路网上都清晰可读）。
 *
 * @param ctx 画布上下文
 * @param text 文本
 * @param x 绘制 x
 * @param y 绘制 y
 * @param fontSize 字号
 */
function fillTextWithStroke(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
): void {
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(13, 17, 23, 0.85)'
  ctx.lineWidth = Math.max(2, fontSize * CAPTION_STROKE_RATIO)
  ctx.strokeText(text, x, y)
  ctx.fillText(text, x, y)
}

/**
 * 截断超宽文本并追加省略号（HUD 标题过长时避免出血）。
 *
 * @param ctx 画布上下文
 * @param text 原文本
 * @param maxWidth 最大宽度（像素）
 */
function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text
  }
  let result = text
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}…`
}

/**
 * 绘制轨迹与光标：全程衬边 + 底色 + 已走橙色高亮 + 当前位置光标（光晕 + 白边芯）。
 * 与在线回放同一套配色（橙 #ff9f43 / 青 #34d9ff）。
 *
 * @param ctx 画布上下文
 * @param points 帧绘制点
 * @param position 目标时刻的插值像素位置
 * @param nextIndex 目标时刻所在段的右端点索引（已走部分画到此点）
 */
function drawTrack(
  ctx: CanvasRenderingContext2D,
  points: readonly FramePoint[],
  position: { px: number; py: number },
  nextIndex: number,
): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 全程轨迹：白色衬边 + 暗灰内线（浅色地图瓦片上双向可见）
  ctx.strokeStyle = TRAIL_CASING_COLOR
  ctx.lineWidth = 8
  ctx.beginPath()
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.px, point.py)
    } else {
      ctx.lineTo(point.px, point.py)
    }
  })
  ctx.stroke()
  ctx.strokeStyle = TRAIL_BASE_COLOR
  ctx.lineWidth = 5
  ctx.stroke()

  // 已走部分：白色衬边 + 橙色高亮（带辉光），推进端连到插值位置
  const endIndex = Math.min(Math.max(nextIndex, 0), points.length - 1)
  ctx.strokeStyle = TRAIL_CASING_COLOR
  ctx.lineWidth = 9
  ctx.beginPath()
  for (let i = 0; i <= endIndex; i++) {
    const point = points[i]!
    if (i === 0) {
      ctx.moveTo(point.px, point.py)
    } else {
      ctx.lineTo(point.px, point.py)
    }
  }
  ctx.lineTo(position.px, position.py)
  ctx.stroke()
  ctx.strokeStyle = TRAVELED_COLOR
  ctx.lineWidth = 6
  ctx.shadowColor = TRAVELED_COLOR
  ctx.shadowBlur = 10
  ctx.stroke()
  ctx.shadowBlur = 0

  // 当前位置光标：光晕 + 白边亮芯（与在线回放 CircleMarker 同构）
  ctx.fillStyle = 'rgba(52, 217, 255, 0.25)'
  ctx.beginPath()
  ctx.arc(position.px, position.py, 16, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = CURSOR_COLOR
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(position.px, position.py, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

/**
 * 绘制光标数据牌：速度/心率/功率（缺失省略，全缺隐藏）。
 * 位置跟随光标（默认上方，贴顶时翻到下方），横向钳制在画布内。
 *
 * @param ctx 画布上下文
 * @param point 目标时刻所在段的右端点记录（与在线回放同取点规则）
 * @param px 光标像素 x
 * @param py 光标像素 y
 * @param layout 画布布局
 * @param fontSize 数据牌字号
 */
function drawCursorTip(
  ctx: CanvasRenderingContext2D,
  point: FramePoint | undefined,
  px: number,
  py: number,
  layout: CanvasLayout,
  fontSize: number,
): void {
  const items = formatCursorTipItems(point)
  if (items.length === 0) {
    return
  }
  ctx.font = `bold ${fontSize}px ${HUD_FONT_FAMILY}`
  const itemGap = Math.round(fontSize * 0.9)
  const textWidths = items.map((text) => ctx.measureText(text).width)
  const boxWidth = textWidths.reduce((sum, width) => sum + width, 0) + itemGap * (items.length + 1)
  const boxHeight = Math.round(fontSize * 2)
  const boxX = Math.min(Math.max(px - boxWidth / 2, 8), layout.width - boxWidth - 8)
  const above = py - 34 - boxHeight >= 8
  const boxY = above ? py - 34 - boxHeight : py + 34

  // 圆角深色牌底 + 细边
  ctx.fillStyle = 'rgba(13, 17, 23, 0.85)'
  ctx.strokeStyle = 'rgba(230, 237, 243, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 10)
  ctx.fill()
  ctx.stroke()

  // 条目文字（白色，逐项排布）
  ctx.fillStyle = '#f0f6fc'
  ctx.textBaseline = 'middle'
  let cursorX = boxX + itemGap
  items.forEach((text, index) => {
    ctx.fillText(text, cursorX, boxY + boxHeight / 2 + 1)
    cursorX += textWidths[index]! + itemGap
  })
  ctx.textBaseline = 'alphabetic'
}

/**
 * 绘制 HUD（左上角活动标题 + 已骑距离/时长）与底图署名（右下角）。
 *
 * @param ctx 画布上下文
 * @param layout 画布布局
 * @param fonts 字号表
 * @param title 活动标题
 * @param distanceLabel 已骑距离文案
 * @param durationLabel 已骑时长文案
 * @param showAttribution 是否地图模式（仅地图模式需底图署名）
 */
function drawHud(
  ctx: CanvasRenderingContext2D,
  layout: CanvasLayout,
  fonts: FontSizes,
  title: string,
  distanceLabel: string,
  durationLabel: string,
  showAttribution: boolean,
): void {
  const x = layout.padding / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(13, 17, 23, 0.9)'
  ctx.shadowBlur = 6
  ctx.font = `bold ${fonts.title}px ${HUD_FONT_FAMILY}`
  ctx.fillStyle = HUD_TEXT_COLOR
  ctx.fillText(
    truncateToWidth(ctx, title, layout.width - layout.padding - x),
    x,
    layout.padding / 2,
  )
  ctx.font = `${fonts.body}px ${HUD_FONT_FAMILY}`
  ctx.fillStyle = HUD_LABEL_COLOR
  ctx.fillText(`${distanceLabel} · ${durationLabel}`, x, layout.padding / 2 + fonts.title * 1.36)

  if (showAttribution) {
    ctx.font = `${fonts.attribution}px ${HUD_FONT_FAMILY}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(MAP_ATTRIBUTION_TEXT, layout.width - 12, layout.height - 12)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
  }
  ctx.shadowBlur = 0
}

/**
 * 绘制字幕：开头钩子（居中偏上，前 4 秒）与数据行（居中贴底，全程）。
 * 文案为空数组时跳过（数据缺失不伪造）。
 *
 * @param ctx 画布上下文
 * @param layout 画布布局
 * @param fonts 字号表
 * @param captions 字幕文本
 * @param showHook 当前时刻是否展示钩子
 */
function drawCaptions(
  ctx: CanvasRenderingContext2D,
  layout: CanvasLayout,
  fonts: FontSizes,
  captions: VideoCaptionTexts,
  showHook: boolean,
): void {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'

  const hook = captions.hook
  if (showHook && hook !== undefined) {
    ctx.font = `bold ${fonts.hook}px ${HUD_FONT_FAMILY}`
    const lineHeight = fonts.hook * 1.32
    const startY = layout.height * 0.14
    hook.forEach((line, index) => {
      fillTextWithStroke(ctx, line, layout.width / 2, startY + index * lineHeight, fonts.hook)
    })
  }

  const dataLine = captions.dataLine
  if (dataLine !== undefined) {
    ctx.font = `bold ${fonts.dataLine}px ${HUD_FONT_FAMILY}`
    const lineHeight = fonts.dataLine * 1.3
    // 整块贴底：末行基线在安全边距之上，避开右下角署名
    const bottomY = layout.height - layout.padding - (dataLine.length - 1) * lineHeight
    dataLine.forEach((line, index) => {
      fillTextWithStroke(
        ctx,
        line,
        layout.width / 2,
        bottomY + index * lineHeight,
        fonts.dataLine,
      )
    })
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/**
 * 把字幕（开头钩子 + 底部数据行）绘制到任意 2D 上下文。
 *
 * 「真实页面录制」（pageCaptureExport.ts）的合成画布复用这套规则：真实页面自带 UI 与轨迹，
 * 只需叠一层字幕；字号/位置/描边与自绘版完全同源，保证两种来源的成片观感统一。
 *
 * @param ctx 2D 上下文
 * @param layout 画布布局（决定字号与安全边距）
 * @param captions 字幕文本
 * @param elapsedSeconds 当前录制时刻（秒）：决定钩子是否仍在展示窗口内
 */
export function drawVideoCaptions(
  ctx: CanvasRenderingContext2D,
  layout: CanvasLayout,
  captions: VideoCaptionTexts,
  elapsedSeconds: number,
): void {
  drawCaptions(ctx, layout, fontSizesOf(layout), captions, elapsedSeconds <= HOOK_DURATION_SECONDS)
}

/**
 * 一帧的全部绘制上下文（避免 drawFrame 参数列表过长）。
 */
interface FrameRenderer {
  /** 画布布局 */
  layout: CanvasLayout

  /** 字号表 */
  fonts: FontSizes

  /** 帧绘制点 */
  points: readonly FramePoint[]

  /** 地图底图（undefined 时示意底图） */
  backdrop: MapBackdrop | undefined

  /** 首点时间戳 */
  firstTs: number

  /** 首末时间戳跨度（秒） */
  totalSpan: number

  /** 活动标题 */
  title: string

  /** 字幕文本 */
  captions: VideoCaptionTexts

  /** 视频时长（秒，钩子展示窗口换算用） */
  durationSeconds: number
}

/**
 * 绘制一帧：底图（地图或示意）→ 轨迹与光标 → 数据牌 → 字幕 → HUD。
 *
 * @param ctx 画布上下文
 * @param renderer 帧绘制上下文
 * @param progress 归一化播放进度 [0, 1]
 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  renderer: FrameRenderer,
  progress: number,
): void {
  const { layout, fonts, points, backdrop } = renderer
  if (backdrop !== undefined) {
    drawMapBackground(ctx, backdrop, layout)
  } else {
    drawSchematicBackground(ctx, layout)
  }

  const ts = renderer.firstTs + progress * renderer.totalSpan
  const { px, py, nextIndex } = findFramePosition(points, ts)
  drawTrack(ctx, points, { px, py }, nextIndex)
  drawCursorTip(ctx, points[nextIndex], px, py, layout, fonts.body)

  const elapsed = progress * renderer.totalSpan
  drawCaptions(ctx, layout, fonts, renderer.captions, elapsed <= HOOK_DURATION_SECONDS)
  drawHud(
    ctx,
    layout,
    fonts,
    renderer.title,
    formatDistance(points[nextIndex]!.distance),
    formatDuration(elapsed),
    backdrop !== undefined,
  )
}

/**
 * 格式化距离标签（米 <1000 用 m，否则 km）。
 *
 * @param meters 累计距离（米）；undefined 显示占位符
 */
function formatDistance(meters: number | undefined): string {
  if (meters === undefined) {
    return '—'
  }
  return meters < 1000 ? `${meters.toFixed(0)} m` : `${(meters / 1000).toFixed(2)} km`
}

/**
 * 格式化时长标签（秒 → mm:ss 或 h:mm:ss）。
 *
 * @param seconds 时长（秒）
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 按画布短边换算各号字号（三种比例观感一致）。
 *
 * @param layout 画布布局
 */
function fontSizesOf(layout: CanvasLayout): FontSizes {
  const side = layout.shortSide
  return {
    title: Math.round(side * 0.026),
    body: Math.round(side * 0.019),
    attribution: Math.round(side * 0.013),
    hook: Math.round(side * 0.059),
    dataLine: Math.round(side * 0.037),
  }
}

/**
 * 导出轨迹回放视频（与在线回放同款视觉）。
 *
 * @param records 清洗后的完整逐点数据（导入时的原始坐标）
 * @param activityName 活动标题（HUD 展示）
 * @param options 画布比例/时长/底图/字幕/坐标系等选项
 * @returns 导出的 Blob 与格式信息；轨迹不足 2 个坐标点或环境不支持录制时返回 undefined
 */
export async function exportTrackReplayVideo(
  records: readonly ActivityRecord[],
  activityName: string,
  options?: TrackVideoExportOptions,
): Promise<TrackVideoExportResult | undefined> {
  const mimeType = pickVideoMimeType()
  if (mimeType === undefined || typeof document === 'undefined') {
    return undefined
  }

  const layout = canvasLayoutOf(options?.aspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO)
  const fonts = fontSizesOf(layout)

  const coordRecords = records.filter(
    (record) => record.latitude !== undefined && record.longitude !== undefined,
  )
  if (coordRecords.length < 2) {
    return undefined
  }

  // 底图恒为高德（GCJ-02）：轨迹先投影到底图坐标系，否则整条轨迹偏移（与页面地图同口径）
  const projection: ProjectOptions = {
    from: options?.coordinateSystem ?? 'wgs84',
    to: 'gcj02',
    northMeters: options?.trackOffset?.northMeters,
    eastMeters: options?.trackOffset?.eastMeters,
  }
  // projectPoint 的入参要求经纬度必填（ActivityRecord 里是可选的），
  // 这里只投影坐标、其余字段原样保留，避免类型上把可选字段收窄
  const projected = coordRecords.map((record) => ({
    ...record,
    ...projectPoint(
      { latitude: record.latitude!, longitude: record.longitude! },
      projection,
    ),
  }))

  const bounds: LatLngBounds = {
    minLat: Math.min(...projected.map((record) => record.latitude!)),
    maxLat: Math.max(...projected.map((record) => record.latitude!)),
    minLng: Math.min(...projected.map((record) => record.longitude!)),
    maxLng: Math.max(...projected.map((record) => record.longitude!)),
  }
  const zoom = computeFittedZoom(bounds, layout.width, layout.height, layout.padding)
  const originX =
    (lngToWorldPx(bounds.minLng, zoom) + lngToWorldPx(bounds.maxLng, zoom)) / 2 - layout.width / 2
  const originY =
    (latToWorldPx(bounds.minLat, zoom) + latToWorldPx(bounds.maxLat, zoom)) / 2 -
    layout.height / 2
  const mapMode = resolveVideoMapMode(options?.mapMode ?? 'follow')
  const backdrop = await loadMapBackdrop(zoom, originX, originY, layout, mapMode)

  const points = buildFramePoints(projected, backdrop !== undefined ? zoom : undefined, layout)
  if (points === undefined) {
    return undefined
  }
  // 时间轴改用运动时间（折叠红灯/休息等暂停，与在线回放同一口径），
  // 视频里不再出现光标长时间静止的画段；几何坐标不变，全程轨迹线形状一致
  const framePoints: readonly FramePoint[] = buildMovingTimeline(points)

  const durationSeconds = options?.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS
  const firstTs = framePoints[0]!.timestamp
  const lastTs = framePoints[framePoints.length - 1]!.timestamp
  const totalSpan = Math.max(lastTs - firstTs, 1)

  const captionOptions = options?.captions ?? {}
  const captions = buildVideoCaptionTexts({
    distanceMeters: captionOptions.distanceMeters ?? points[points.length - 1]!.distance,
    elevationGainMeters: captionOptions.elevationGainMeters,
    movingSeconds: captionOptions.movingSeconds,
    videoSeconds: durationSeconds,
    showHook: captionOptions.hook ?? true,
    showDataLine: captionOptions.dataLine ?? true,
    hookText: captionOptions.hookText,
    dataLineText: captionOptions.dataLineText,
  })

  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return undefined
  }
  // 显式非空引用：闭包内使用时 TS 收窄不跨函数边界
  const drawingCtx: CanvasRenderingContext2D = ctx

  const stream = canvas.captureStream(VIDEO_FPS)
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITRATE })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    recorder.onerror = () => reject(new Error('MediaRecorder failed'))
  })

  recorder.start()

  const renderer: FrameRenderer = {
    layout,
    fonts,
    points: framePoints,
    backdrop,
    firstTs,
    totalSpan,
    title: activityName,
    captions,
    durationSeconds,
  }

  // 逐帧推进：requestAnimationFrame 驱动真实时钟，播完 durationSeconds 即停止
  const startTime = performance.now()
  let lastReportedSecond = -1
  options?.onProgress?.(0, durationSeconds)
  await new Promise<void>((resolve) => {
    function tick() {
      const elapsedMs = performance.now() - startTime
      const progress = Math.min(elapsedMs / (durationSeconds * 1000), 1)
      drawFrame(drawingCtx, renderer, progress)
      // 进度按整秒节流上报，避免每帧触发调用方 setState
      const second = Math.floor(Math.min(elapsedMs / 1000, durationSeconds))
      if (second !== lastReportedSecond) {
        lastReportedSecond = second
        options?.onProgress?.(second, durationSeconds)
      }
      if (progress >= 1) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  // 给最后一帧留出编码时间再停表
  await new Promise((resolve) => setTimeout(resolve, 120))
  recorder.stop()
  stream.getTracks().forEach((track) => track.stop())

  const blob = await finished
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
  return { blob, mimeType, extension }
}

/**
 * 触发浏览器下载导出的视频 Blob。
 *
 * @param fileName 下载文件名
 * @param blob 视频 Blob
 */
export function downloadVideo(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
