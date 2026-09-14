/**
 * 赛段新纪录分享卡（赛段重设计二期）。
 *
 * 纯 Canvas 本地绘制（无网络请求，与 shareCanvas 同思路）：
 * 深蓝底 + 品牌荧光绿，版式为「赛段名 → 大号用时 → 差值 → 指标条」，
 * 数字全部来自本次成绩（与页面同源，确定性口径）。
 * 独立成文件而非扩 shareCanvas 的 ShareData：赛段维度与活动维度
 * 数据结构差异大，硬塞进现有 switch 会牵连四页布局。
 */
/** 画布逻辑尺寸（与 shareCanvas 同规格） */
const WIDTH = 1080
const HEIGHT = 1440
const SCALE = 2
const PAD = 72

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif'

/** 分享卡数据（文本已格式化，绘制层不做计算） */
export interface SegmentPrShareData {
  /** 赛段名 */
  segmentName: string

  /** 本次用时（如 "0:47"） */
  durationText: string

  /** 差值文案（如 "比个人最好快 5 秒"） */
  deltaText: string

  /** 日期（如 "2026-09-12"） */
  dateText: string

  /** 距离（如 "0.40 km"） */
  distanceText: string

  /** 均速（缺失不显示） */
  avgSpeedText?: string

  /** 均功率（缺失不显示） */
  avgPowerText?: string

  /** 均心率（缺失不显示） */
  avgHeartRateText?: string
}

/**
 * 绘制赛段新纪录卡。
 *
 * @param canvas 目标画布
 * @param data 分享数据
 * @returns 绘制成功返回 true（jsdom 无 2d context 时 false）
 */
export function drawSegmentPrCard(canvas: HTMLCanvasElement, data: SegmentPrShareData): boolean {
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return false
  }
  canvas.width = WIDTH * SCALE
  canvas.height = HEIGHT * SCALE
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'alphabetic'

  // 深蓝底（与站点浅色主题主色一致的品牌底）
  ctx.fillStyle = '#0d3b4c'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // 顶部品牌行
  ctx.fillStyle = '#b8e62e'
  ctx.font = `700 26px ${SANS}`
  ctx.fillText('RIDE TRACK · 赛段新纪录', PAD, 120)
  ctx.fillStyle = 'rgba(232, 234, 237, 0.6)'
  ctx.font = `24px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText(data.dateText, WIDTH - PAD, 120)
  ctx.textAlign = 'left'

  // 赛段名（可两行折行）
  ctx.fillStyle = '#e8eaed'
  ctx.font = `700 56px ${SANS}`
  const maxWidth = WIDTH - PAD * 2
  if (ctx.measureText(data.segmentName).width <= maxWidth) {
    ctx.fillText(data.segmentName, PAD, 260)
  } else {
    let line = data.segmentName
    let cut = data.segmentName.length
    while (cut > 1 && ctx.measureText(line).width > maxWidth) {
      cut -= 1
      line = data.segmentName.slice(0, cut)
    }
    ctx.fillText(line, PAD, 260)
    ctx.fillText(data.segmentName.slice(cut), PAD, 332)
  }

  // 大号用时
  ctx.fillStyle = '#b8e62e'
  ctx.font = `800 200px ${SANS}`
  ctx.fillText(data.durationText, PAD, 640)

  // 差值文案
  ctx.fillStyle = '#e8eaed'
  ctx.font = `600 40px ${SANS}`
  ctx.fillText(data.deltaText, PAD, 740)

  // 分隔线
  ctx.strokeStyle = 'rgba(184, 230, 46, 0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, 850)
  ctx.lineTo(WIDTH - PAD, 850)
  ctx.stroke()

  // 指标条（最多 4 项，缺失项整体跳过）
  const metrics: { value: string; label: string }[] = [
    { value: data.distanceText, label: '距离' },
    ...(data.avgSpeedText !== undefined ? [{ value: data.avgSpeedText, label: '均速' }] : []),
    ...(data.avgPowerText !== undefined ? [{ value: data.avgPowerText, label: '均功率' }] : []),
    ...(data.avgHeartRateText !== undefined
      ? [{ value: data.avgHeartRateText, label: '均心率' }]
      : []),
  ]
  const columnWidth = (WIDTH - PAD * 2) / Math.max(1, metrics.length)
  metrics.forEach((metric, index) => {
    const x = PAD + index * columnWidth
    ctx.fillStyle = '#e8eaed'
    ctx.font = `700 44px ${SANS}`
    ctx.fillText(metric.value, x, 960)
    ctx.fillStyle = 'rgba(232, 234, 237, 0.55)'
    ctx.font = `24px ${SANS}`
    ctx.fillText(metric.label, x, 1004)
  })

  // 底部说明
  ctx.fillStyle = 'rgba(232, 234, 237, 0.4)'
  ctx.font = `22px ${SANS}`
  ctx.fillText('骑行数据本地生成 · 起终点圆穿越计时', PAD, HEIGHT - PAD)

  return true
}

/**
 * 绘制并下载赛段新纪录 PNG。
 *
 * @param data 分享数据
 * @param fileName 下载文件名（不含扩展名）
 * @returns 绘制失败（jsdom）返回 false
 */
export function downloadSegmentPrPng(data: SegmentPrShareData, fileName: string): boolean {
  const canvas = document.createElement('canvas')
  if (!drawSegmentPrCard(canvas, data)) {
    return false
  }
  canvas.toBlob((blob) => {
    if (blob === null) {
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${fileName}.png`
    anchor.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
  return true
}
