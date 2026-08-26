/**
 * 轨迹回放视频导出（规格外：用户需求）。
 *
 * 将单活动轨迹渲染为固定时长（默认 10 秒）的 MP4 回放视频：
 * 暗色底 + 网格背景，蓝色进度线沿轨迹推进，当前位置亮点 + 尾迹渐隐，
 * 左上角 HUD 展示活动名与已骑行距离/时长。
 *
 * 技术路线：Canvas 2D 逐帧绘制 → canvas.captureStream() → MediaRecorder
 * 录制为 WebM/MP4 容器。浏览器优先选择 video/mp4 编码（Chrome 126+/Safari 原生
 * 支持），不支持时降级 video/webm 并保留 .webm 后缀——文件能导出但扩展名如实。
 * 无外部依赖、无网络请求，作者源只读活动同样可导出。
 */
import type { ActivityRecord } from '@/types/activity'

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

/** 进度线颜色（主题蓝） */
const ROUTE_COLOR = '#4f8cff'

/** 未走到的轨迹底色（暗灰） */
const TRAIL_BASE_COLOR = 'rgba(255, 255, 255, 0.08)'

/** 当前位置点颜色（亮青） */
const POSITION_COLOR = '#34d9ff'

/** 背景色（深空黑） */
const BACKGROUND_COLOR = '#0d1117'

/** HUD 文字颜色 */
const HUD_TEXT_COLOR = '#c9d1d9'

/** HUD 标签颜色（弱化灰） */
const HUD_LABEL_COLOR = '#8b949e'

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

/**
 * WGS-84 经纬度 → 等距圆柱平面坐标（x/y 米）。仅用于相对形状投影，不要求精确等积。
 *
 * @param latitude 纬度（度）
 * @param longitude 经度（度）
 */
function latLngToXY(latitude: number, longitude: number): { x: number; y: number } {
  const latRad = (latitude * Math.PI) / 180
  return {
    x: longitude * 111320 * Math.cos(latRad),
    y: latitude * 110540,
  }
}

/**
 * 提取含坐标的逐点记录并投影为平面坐标序列。
 *
 * @param records 完整逐点数据
 * @returns 平面坐标点列表（timestamp 透传）；不足 2 点时返回 undefined
 */
interface ProjectedPoint {
  timestamp: number
  x: number
  y: number
}

function projectTrack(records: readonly ActivityRecord[]): ProjectedPoint[] | undefined {
  const projected: ProjectedPoint[] = []
  for (const record of records) {
    if (record.latitude === undefined || record.longitude === undefined) {
      continue
    }
    const { x, y } = latLngToXY(record.latitude, record.longitude)
    projected.push({ timestamp: record.timestamp, x, y })
  }
  return projected.length >= 2 ? projected : undefined
}

/**
 * 计算轨迹包围盒。
 */
function computeBounds(points: readonly ProjectedPoint[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }
  return { minX, maxX, minY, maxY }
}

/**
 * 构造画布坐标变换：等比缩放轨迹至安全区内并居中。
 *
 * @param bounds 包围盒
 * @returns 世界坐标 → 画布像素坐标函数
 */
function buildTransformer(bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1)
  const scale = Math.min(
    (CANVAS_WIDTH - PADDING * 2) / spanX,
    (CANVAS_HEIGHT - PADDING * 2) / spanY,
  )
  const offsetX = (CANVAS_WIDTH - spanX * scale) / 2
  const offsetY = (CANVAS_HEIGHT - spanY * scale) / 2
  // y 轴翻转：世界坐标北为正，画布向下为正
  return (point: ProjectedPoint): { px: number; py: number } => ({
    px: offsetX + (point.x - bounds.minX) * scale,
    py: CANVAS_HEIGHT - offsetY - (point.y - bounds.minY) * scale,
  })
}

/**
 * 绘制一帧：背景网格 + 全程轨迹底色 + 已走进度线 + 当前位置光点 + HUD。
 *
 * @param ctx 画布上下文
 * @param pixelPoints 画布像素坐标点序列
 * @param progress 归一化播放进度 [0, 1]
 * @param title 活动标题
 * @param distanceLabel 已骑距离文案
 * @param durationLabel 已骑时长文案
 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  pixelPoints: ReadonlyArray<{ px: number; py: number }>,
  progress: number,
  title: string,
  distanceLabel: string,
  durationLabel: string,
): void {
  // 背景
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  // 装饰网格（每 64px 一条淡线）
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

  // 全程轨迹底色（未走部分）
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = TRAIL_BASE_COLOR
  ctx.lineWidth = 4
  ctx.beginPath()
  pixelPoints.forEach((pt, index) => {
    if (index === 0) {
      ctx.moveTo(pt.px, pt.py)
    } else {
      ctx.lineTo(pt.px, pt.py)
    }
  })
  ctx.stroke()

  // 已走进度线（按比例截断折线）
  const totalSegments = pixelPoints.length - 1
  const targetIndex = Math.min(Math.floor(progress * totalSegments), totalSegments)
  ctx.strokeStyle = ROUTE_COLOR
  ctx.lineWidth = 5
  ctx.shadowColor = ROUTE_COLOR
  ctx.shadowBlur = 12
  ctx.beginPath()
  for (let i = 0; i <= targetIndex; i++) {
    const pt = pixelPoints[i]!
    if (i === 0) {
      ctx.moveTo(pt.px, pt.py)
    } else {
      ctx.lineTo(pt.px, pt.py)
    }
  }
  ctx.stroke()
  ctx.shadowBlur = 0

  // 当前位置光点
  const currentPt = pixelPoints[targetIndex]!
  ctx.fillStyle = POSITION_COLOR
  ctx.beginPath()
  ctx.arc(currentPt.px, currentPt.py, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(52, 217, 255, 0.25)'
  ctx.beginPath()
  ctx.arc(currentPt.px, currentPt.py, 16, 0, Math.PI * 2)
  ctx.fill()

  // HUD 左上角：活动标题 + 已骑距离/时长
  ctx.textBaseline = 'top'
  ctx.font = `bold 28px ${HUD_FONT_FAMILY}`
  ctx.fillStyle = HUD_TEXT_COLOR
  ctx.fillText(title, PADDING / 2, PADDING / 2)

  ctx.font = `20px ${HUD_FONT_FAMILY}`
  ctx.fillStyle = HUD_LABEL_COLOR
  ctx.fillText(`${distanceLabel} · ${durationLabel}`, PADDING / 2, PADDING / 2 + 38)
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
 * 导出轨迹回放视频。
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
  const trackPoints = projectTrack(records)
  if (trackPoints === undefined) {
    return undefined
  }

  const mimeType = pickMimeType()
  if (mimeType === undefined || typeof document === 'undefined') {
    return undefined
  }

  const durationSeconds = options?.durationSeconds ?? VIDEO_DURATION_SECONDS
  const bounds = computeBounds(trackPoints)
  const transform = buildTransformer(bounds)
  const pixelPoints = trackPoints.map(transform)

  // 首末点时间戳用于 HUD 的实时距离/时长插值
  const firstTs = trackPoints[0]!.timestamp
  const lastTs = trackPoints[trackPoints.length - 1]!.timestamp
  const totalSpan = Math.max(lastTs - firstTs, 1)

  // 累计距离序列（有 distance 字段则直接用，否则按索引占比近似）
  const hasDistanceField = records.some((record) => record.distance !== undefined)
  const coordRecords = records.filter(
    (record) => record.latitude !== undefined && record.longitude !== undefined,
  )

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

      // HUD 数据：按进度在首末记录间线性插值
      const tsAtProgress = firstTs + progress * totalSpan
      const idx = Math.min(
        Math.floor(progress * (coordRecords.length - 1)),
        coordRecords.length - 1,
      )
      const nearestRecord = coordRecords[Math.max(idx, 0)]!
      const distanceValue = hasDistanceField ? nearestRecord.distance : undefined
      drawFrame(
        drawingCtx,
        pixelPoints,
        progress,
        activityName,
        formatDistance(distanceValue ?? nearestRecord.distance),
        formatDuration(tsAtProgress - firstTs),
      )

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

