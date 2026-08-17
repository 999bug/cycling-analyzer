/**
 * 年度分享图（后续工作项：社交分享）。
 *
 * 纯 Canvas 2D 绘制年度数据卡片（无第三方依赖），2x 缩放导出高清 PNG，
 * 用户下载后可分享到社交媒体。模型层 buildShareCardModel 为纯函数可测；
 * 绘制层 drawShareCard 只做 canvas 调用，颜色与全局 CSS 变量保持一致。
 */
import type { StatisticsMetrics } from '@/features/statistics/statistics'
import type { MonthlyDistance } from '@/features/yearReview/yearReview'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'

/** 卡片逻辑宽度（px，导出时 ×2） */
export const SHARE_CARD_WIDTH = 640

/** 卡片逻辑高度（px，导出时 ×2） */
export const SHARE_CARD_HEIGHT = 820

/** 高清导出缩放比 */
const EXPORT_SCALE = 2

/** 分享图配色（与 index.css 深色主题变量一致） */
const COLORS = {
  background: '#121417',
  surface: '#1b1e23',
  text: '#e8eaed',
  secondary: '#9aa0a6',
  primary: '#4f8cff',
  border: '#2a2e35',
  bar: '#3d4759',
} as const

/** 字体栈（中文按系统可用字体回退） */
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif'

/** 内边距 */
const PADDING = 48

/**
 * 分享图数据模型。
 */
export interface ShareCardModel {
  /** 年份 */
  year: number

  /** 四项年度指标（label + 已格式化 value） */
  stats: ReadonlyArray<{ label: string; value: string }>

  /** 12 个月距离（显示单位），柱状图数据 */
  monthlyDistances: readonly number[]

  /** 距离单位标签（km / mi） */
  unitLabel: string
}

/** 数字格式化：千分位 + 最多 1 位小数 */
const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

/**
 * 构造分享图模型（纯函数）。
 *
 * @param year 年份
 * @param metrics 年度指标（buildStatistics 结果）
 * @param months 月度距离（buildMonthlyDistances 结果，米）
 * @param distanceUnit 距离显示单位
 */
export function buildShareCardModel(
  year: number,
  metrics: StatisticsMetrics,
  months: readonly MonthlyDistance[],
  distanceUnit: DistanceUnit,
): ShareCardModel {
  const hours = metrics.totalDuration / 3600
  return {
    year,
    stats: [
      { label: '骑行次数', value: `${metrics.count} 次` },
      { label: '总距离', value: formatDistanceByUnit(metrics.totalDistance, distanceUnit) },
      { label: '总时长', value: `${numberFormatter.format(hours)} 小时` },
      { label: '总爬升', value: `${numberFormatter.format(Math.round(metrics.totalElevationGain))} 米` },
    ],
    monthlyDistances: months.map((month) =>
      distanceUnit === 'mi' ? month.distance / 1609.344 : month.distance / 1000,
    ),
    unitLabel: distanceUnit,
  }
}

/**
 * 绘制分享图到 canvas（2x 缩放，导出高清）。
 * getContext 不可用（如 jsdom）时返回 false，调用方降级处理。
 *
 * @param canvas 目标画布
 * @param model 分享图模型
 * @returns 绘制成功返回 true
 */
export function drawShareCard(canvas: HTMLCanvasElement, model: ShareCardModel): boolean {
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return false
  }

  canvas.width = SHARE_CARD_WIDTH * EXPORT_SCALE
  canvas.height = SHARE_CARD_HEIGHT * EXPORT_SCALE
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE)
  ctx.textBaseline = 'alphabetic'

  // 背景与边框
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT)
  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, SHARE_CARD_WIDTH - 1, SHARE_CARD_HEIGHT - 1)

  // 顶部品牌行
  ctx.fillStyle = COLORS.secondary
  ctx.font = `16px ${FONT_FAMILY}`
  ctx.fillText('骑行数据 · 年度回顾', PADDING, 88)

  // 大年份
  ctx.fillStyle = COLORS.text
  ctx.font = `bold 88px ${FONT_FAMILY}`
  ctx.fillText(String(model.year), PADDING, 190)
  const yearWidth = ctx.measureText(String(model.year)).width
  ctx.fillStyle = COLORS.secondary
  ctx.font = `28px ${FONT_FAMILY}`
  ctx.fillText('年', PADDING + yearWidth + 8, 190)

  // 四项指标（2×2 网格）
  const columnX = [PADDING, SHARE_CARD_WIDTH / 2 + 8]
  model.stats.forEach((stat, index) => {
    const x = columnX[index % 2]
    const rowY = index < 2 ? 268 : 368
    ctx.fillStyle = COLORS.secondary
    ctx.font = `14px ${FONT_FAMILY}`
    ctx.fillText(stat.label, x, rowY)
    ctx.fillStyle = COLORS.text
    ctx.font = `bold 30px ${FONT_FAMILY}`
    ctx.fillText(stat.value, x, rowY + 44)
  })

  // 月度距离柱状图
  ctx.fillStyle = COLORS.secondary
  ctx.font = `14px ${FONT_FAMILY}`
  ctx.fillText(`月度距离（${model.unitLabel}）`, PADDING, 486)

  const chartLeft = PADDING
  const chartWidth = SHARE_CARD_WIDTH - PADDING * 2
  const barGap = 8
  const barWidth = (chartWidth - barGap * 11) / 12
  const baseline = 660
  const maxBarHeight = 140
  const maxDistance = Math.max(...model.monthlyDistances, 0)
  model.monthlyDistances.forEach((distance, index) => {
    const height = maxDistance > 0 ? (distance / maxDistance) * maxBarHeight : 0
    const x = chartLeft + index * (barWidth + barGap)
    // 最高的月份用主题色高亮，其余用中性色
    ctx.fillStyle = distance === maxDistance && maxDistance > 0 ? COLORS.primary : COLORS.bar
    if (height > 0) {
      ctx.fillRect(x, baseline - height, barWidth, height)
    }
    ctx.fillStyle = COLORS.secondary
    ctx.font = `12px ${FONT_FAMILY}`
    const label = String(index + 1)
    ctx.fillText(label, x + (barWidth - ctx.measureText(label).width) / 2, baseline + 26)
  })

  // 底部分隔线与落款
  ctx.strokeStyle = COLORS.border
  ctx.beginPath()
  ctx.moveTo(PADDING, 740)
  ctx.lineTo(SHARE_CARD_WIDTH - PADDING, 740)
  ctx.stroke()
  ctx.fillStyle = COLORS.secondary
  ctx.font = `12px ${FONT_FAMILY}`
  ctx.fillText('数据保存在本地浏览器 · 由「骑行数据」生成', PADDING, 776)
  return true
}

/**
 * 下载分享图 PNG。
 *
 * @param canvas 已绘制的画布
 * @param year 年份（文件名用）
 */
export function downloadShareCardPng(canvas: HTMLCanvasElement, year: number): void {
  canvas.toBlob((blob) => {
    if (blob === null) {
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `骑行数据-${year}-年度回顾.png`
    anchor.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
