/**
 * 轨迹回放视频导出（规格外：用户需求）。
 *
 * 与在线回放同款视觉：真实地图（OpenStreetMap 瓦片）为底图，整条轨迹暗灰线，
 * 已走部分橙色高亮推进，当前位置青色光标 + 光晕 + 实时数据牌（速度/心率/功率，
 * 缺失字段省略不伪造），位置在记录点间线性插值平滑移动；左上角 HUD 展示活动名
 * 与已骑行距离/时长，右下角 OSM 版权署名。
 *
 * 时间轴与在线回放同一口径：按「运动时间」推进（折叠红灯/休息等暂停时段，
 * 见 buildMovingTimeline），HUD 时长展示的也是运动时长，不会出现光标长时间静止的画段。
 *
 * 技术路线：Canvas 2D 逐帧绘制 → canvas.captureStream() → MediaRecorder 录制。
 * 浏览器优先选择 video/mp4 编码（Chrome 126+/Safari 原生支持），不支持时降级
 * video/webm 并保留 .webm 后缀。地图瓦片以 crossOrigin=anonymous 加载（OSM 支持
 * CORS，画布不被污染，captureStream 可用）；瓦片加载失败（离线/超时/成功率过低）
 * 自动降级为暗色网格示意底图——导出永不因网络失败。
 * 无外部依赖，作者源只读活动同样可导出。
 */
import type { ActivityRecord } from '@/types/activity'
import { buildMovingTimeline, formatCursorTipItems } from '@/map/replayCore'

/** 默认视频时长（秒） */
const VIDEO_DURATION_SECONDS = 10

/** 视频帧率（fps）：MediaRecorder 时间片对齐用 */
const VIDEO_FPS = 30

/** 画布宽度（像素） */
const CANVAS_WIDTH = 1280

/** 画布高度（像素）720p */
const CANVAS_HEIGHT = 720

/** 轨迹绘制安全边距（像素），避免线宽/HUD 出血到画布边缘 */
const PADDING = 80

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

/** OSM 标准瓦片服务（支持 CORS 跨域匿名加载，画布不被污染） */
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/** 地图底图加载整体超时（毫秒）：超时后按已成功瓦片合成或降级 */
const MAP_BACKDROP_TIMEOUT_MS = 5000

/** 地图底图最低成功率：成功瓦片占比低于该值则放弃地图模式 */
const MAP_BACKDROP_MIN_SUCCESS_RATIO = 0.7

/** 拟合缩放的上下限（Web Mercator 瓦片金字塔范围） */
const MAP_ZOOM_MIN = 2
const MAP_ZOOM_MAX = 17

/** HUD 文字颜色 */
const HUD_TEXT_COLOR = '#e6edf3'

/** HUD 标签颜色（弱化灰） */
const HUD_LABEL_COLOR = '#9aa4b2'

/** HUD 字体族 */
const HUD_FONT_FAMILY = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'

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
 * 逐帧绘制用的轨迹点：画布像素坐标 + 数据牌/HUD 所需的记录字段。
 */
interface FramePoint {
  /** Unix 秒时间戳 */
  timestamp: number

  /** 画布像素 x */
  px: number

  /** 画布像素 y */
  py: number

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
 * @returns 支持的 MIME；两者都不支持时返回 undefined
 */
function pickMimeType(): string | undefined {
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
 * 拉取 OSM 瓦片并合成整幅地图底图离屏画布。
 * 成功率不足或整体超时返回 undefined（调用方降级为示意底图）。
 *
 * @param zoom 缩放级别
 * @param originX 视口左上角世界像素 x
 * @param originY 视口左上角世界像素 y
 * @returns 合成结果；环境不支持（无 document/2d 上下文）或成功率过低时 undefined
 */
export async function loadMapBackdrop(
  zoom: number,
  originX: number,
  originY: number,
): Promise<MapBackdrop | undefined> {
  if (typeof document === 'undefined') {
    return undefined
  }
  const { xStart, xEnd, yStart, yEnd } = computeTileRange(
    zoom,
    originX,
    originY,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
  )
  const jobs: Promise<{ x: number; y: number; image: HTMLImageElement }>[] = []
  for (let ty = yStart; ty <= yEnd; ty++) {
    for (let tx = xStart; tx <= xEnd; tx++) {
      const url = OSM_TILE_URL.replace('{z}', String(zoom))
        .replace('{x}', String(tx))
        .replace('{y}', String(ty))
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
  if (jobs.length === 0 || loaded.length / jobs.length < MAP_BACKDROP_MIN_SUCCESS_RATIO) {
    return undefined
  }
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return undefined
  }
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  for (const tile of loaded) {
    ctx.drawImage(tile.image, tile.x * TILE_SIZE - originX, tile.y * TILE_SIZE - originY)
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
 * @param records 完整逐点数据
 * @param backdropZoom 地图模式缩放级别；undefined 时走示意投影
 * @returns 帧绘制点列表（timestamp 升序）；坐标点不足 2 个时返回 undefined
 */
function buildFramePoints(records: readonly ActivityRecord[], backdropZoom: number | undefined): FramePoint[] | undefined {
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
      px: lngToWorldPx(record.longitude!, backdropZoom) - centerX + CANVAS_WIDTH / 2,
      py: latToWorldPx(record.latitude!, backdropZoom) - centerY + CANVAS_HEIGHT / 2,
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
  const scale = Math.min((CANVAS_WIDTH - PADDING * 2) / spanX, (CANVAS_HEIGHT - PADDING * 2) / spanY)
  const offsetX = (CANVAS_WIDTH - spanX * scale) / 2
  const offsetY = (CANVAS_HEIGHT - spanY * scale) / 2
  return meters.map(({ record, x, y }) => ({
    timestamp: record.timestamp,
    px: offsetX + (x - minX) * scale,
    py: CANVAS_HEIGHT - offsetY - (y - minY) * scale,
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
 */
function drawSchematicBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.lineWidth = 1
  for (let gx = 0; gx <= CANVAS_WIDTH; gx += 64) {
    ctx.beginPath()
    ctx.moveTo(gx + 0.5, 0)
    ctx.lineTo(gx + 0.5, CANVAS_HEIGHT)
    ctx.stroke()
  }
  for (let gy = 0; gy <= CANVAS_HEIGHT; gy += 64) {
    ctx.beginPath()
    ctx.moveTo(0, gy + 0.5)
    ctx.lineTo(CANVAS_WIDTH, gy + 0.5)
    ctx.stroke()
  }
}

/**
 * 绘制地图底图（离屏合成图）+ 半透明暗化层（提高轨迹/文字对比度）。
 *
 * @param ctx 画布上下文
 * @param backdrop 地图底图
 */
function drawMapBackground(ctx: CanvasRenderingContext2D, backdrop: MapBackdrop): void {
  ctx.drawImage(backdrop.canvas, 0, 0)
  ctx.fillStyle = 'rgba(13, 17, 23, 0.22)'
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
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
 */
function drawCursorTip(
  ctx: CanvasRenderingContext2D,
  point: FramePoint | undefined,
  px: number,
  py: number,
): void {
  const items = formatCursorTipItems(point)
  if (items.length === 0) {
    return
  }
  ctx.font = `bold 20px ${HUD_FONT_FAMILY}`
  const itemGap = 18
  const textWidths = items.map((text) => ctx.measureText(text).width)
  const boxWidth = textWidths.reduce((sum, width) => sum + width, 0) + itemGap * (items.length + 1)
  const boxHeight = 40
  const boxX = Math.min(Math.max(px - boxWidth / 2, 8), CANVAS_WIDTH - boxWidth - 8)
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
 * 绘制 HUD（左上角活动标题 + 已骑距离/时长）与瓦片署名（右下角）。
 *
 * @param ctx 画布上下文
 * @param title 活动标题
 * @param distanceLabel 已骑距离文案
 * @param durationLabel 已骑时长文案
 * @param mapMode 是否地图模式（地图模式需 OSM 署名）
 */
function drawHud(
  ctx: CanvasRenderingContext2D,
  title: string,
  distanceLabel: string,
  durationLabel: string,
  mapMode: boolean,
): void {
  ctx.textBaseline = 'top'
  ctx.font = `bold 28px ${HUD_FONT_FAMILY}`
  ctx.fillStyle = HUD_TEXT_COLOR
  ctx.shadowColor = 'rgba(13, 17, 23, 0.9)'
  ctx.shadowBlur = 6
  ctx.fillText(title, PADDING / 2, PADDING / 2)
  ctx.font = `20px ${HUD_FONT_FAMILY}`
  ctx.fillStyle = HUD_LABEL_COLOR
  ctx.fillText(`${distanceLabel} · ${durationLabel}`, PADDING / 2, PADDING / 2 + 38)

  if (mapMode) {
    ctx.font = `14px ${HUD_FONT_FAMILY}`
    ctx.textAlign = 'right'
    ctx.fillText('© OpenStreetMap contributors', CANVAS_WIDTH - 12, CANVAS_HEIGHT - 26)
    ctx.textAlign = 'left'
  }
  ctx.shadowBlur = 0
}

/**
 * 绘制一帧：底图（地图或示意）→ 轨迹与光标 → 数据牌 → HUD。
 *
 * @param ctx 画布上下文
 * @param points 帧绘制点
 * @param backdrop 地图底图（undefined 时示意底图）
 * @param progress 归一化播放进度 [0, 1]
 * @param firstTs 首点时间戳
 * @param totalSpan 首末时间戳跨度（秒）
 * @param title 活动标题
 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  points: readonly FramePoint[],
  backdrop: MapBackdrop | undefined,
  progress: number,
  firstTs: number,
  totalSpan: number,
  title: string,
): void {
  if (backdrop !== undefined) {
    drawMapBackground(ctx, backdrop)
  } else {
    drawSchematicBackground(ctx)
  }

  const ts = firstTs + progress * totalSpan
  const { px, py, nextIndex } = findFramePosition(points, ts)
  drawTrack(ctx, points, { px, py }, nextIndex)
  drawCursorTip(ctx, points[nextIndex], px, py)

  const current = points[nextIndex]!
  drawHud(ctx, title, formatDistance(current.distance), formatDuration(ts - firstTs), backdrop !== undefined)
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
 * 导出轨迹回放视频（与在线回放同款视觉）。
 *
 * @param records 清洗后的完整逐点数据
 * @param activityName 活动标题（HUD 展示）
 * @param options.durationSeconds 视频时长（默认 10 秒）
 * @returns 导出的 Blob 与格式信息；轨迹不足 2 个坐标点或环境不支持录制时返回 undefined
 */
export async function exportTrackReplayVideo(
  records: readonly ActivityRecord[],
  activityName: string,
  options?: { durationSeconds?: number },
): Promise<TrackVideoExportResult | undefined> {
  const mimeType = pickMimeType()
  if (mimeType === undefined || typeof document === 'undefined') {
    return undefined
  }

  // 计算地图拟合缩放，尝试加载真实地图底图（失败自动降级示意底图）
  const coordRecords = records.filter(
    (record) => record.latitude !== undefined && record.longitude !== undefined,
  )
  if (coordRecords.length < 2) {
    return undefined
  }
  const bounds: LatLngBounds = {
    minLat: Math.min(...coordRecords.map((record) => record.latitude!)),
    maxLat: Math.max(...coordRecords.map((record) => record.latitude!)),
    minLng: Math.min(...coordRecords.map((record) => record.longitude!)),
    maxLng: Math.max(...coordRecords.map((record) => record.longitude!)),
  }
  const zoom = computeFittedZoom(bounds, CANVAS_WIDTH, CANVAS_HEIGHT, PADDING)
  const originX = (lngToWorldPx(bounds.minLng, zoom) + lngToWorldPx(bounds.maxLng, zoom)) / 2 - CANVAS_WIDTH / 2
  const originY = (latToWorldPx(bounds.minLat, zoom) + latToWorldPx(bounds.maxLat, zoom)) / 2 - CANVAS_HEIGHT / 2
  const backdrop = await loadMapBackdrop(zoom, originX, originY)

  const points = buildFramePoints(records, backdrop !== undefined ? zoom : undefined)
  if (points === undefined) {
    return undefined
  }
  // 显式非空引用：rAF 闭包内 TS 收窄不跨函数边界。
  // 时间轴改用运动时间（折叠红灯/休息等暂停，与在线回放同一口径），
  // 视频里不再出现光标长时间静止的画段；几何坐标不变，全程轨迹线形状一致
  const framePoints: readonly FramePoint[] = buildMovingTimeline(points)

  const durationSeconds = options?.durationSeconds ?? VIDEO_DURATION_SECONDS
  const firstTs = framePoints[0]!.timestamp
  const lastTs = framePoints[framePoints.length - 1]!.timestamp
  const totalSpan = Math.max(lastTs - firstTs, 1)

  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return undefined
  }
  // 显式非空引用：闭包内使用时 TS 收窄不跨函数边界
  const drawingCtx: CanvasRenderingContext2D = ctx

  const stream = canvas.captureStream(VIDEO_FPS)
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
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

  // 逐帧推进：requestAnimationFrame 驱动真实时钟，播完 durationSeconds 即停止
  const startTime = performance.now()
  await new Promise<void>((resolve) => {
    function tick() {
      const elapsedMs = performance.now() - startTime
      const progress = Math.min(elapsedMs / (durationSeconds * 1000), 1)
      drawFrame(drawingCtx, framePoints, backdrop, progress, firstTs, totalSpan, activityName)
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
