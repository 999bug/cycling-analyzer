/**
 * 表现趋势分析（纯函数）。
 *
 * 对周聚合序列做「近 4 周 vs 前 4 周」的趋势对比与最佳周统计，
 * 供表现趋势页展示量化结论（训练量/效率因子/TSS 变化、最强周、训练节奏）。
 * 空周（rides=0）按原样参与均分；缺指标不伪造（undefined）。
 */
import type { WeekSummary } from '@/features/analysis/weeklyStats'

/** 趋势对比窗口：近 N 周 vs 前 N 周 */
const TREND_WINDOW_WEEKS = 4

/** 一组周的均值（空数组返回 undefined，不伪造 0） */
function averageOf(values: readonly number[]): number | undefined {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined
}

/** 取一组周里某指标的均值（缺值周跳过） */
function averageField(
  weeks: readonly WeekSummary[],
  field: 'distance' | 'efficiencyFactor' | 'tss',
): number | undefined {
  const values = weeks
    .map((week) => week[field])
    .filter((value): value is number => typeof value === 'number')
  return averageOf(values)
}

/** 相对变化（百分数，正数上升）；基数为 0 或与现值同为 undefined 时返回 undefined */
function percentChange(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined || previous === undefined || previous === 0) {
    return undefined
  }
  return ((current - previous) / previous) * 100
}

/**
 * 表现趋势分析结果。
 */
export interface PerformanceTrendInsights {
  /** 近 4 周平均周距离（米） */
  recentDistanceAvg: number

  /** 前 4 周平均周距离（米） */
  previousDistanceAvg: number

  /** 近 4 周 vs 前 4 周平均周距离变化（%；前值缺失时为 undefined） */
  distancePercentChange: number | undefined

  /** 近 4 周平均效率因子 */
  recentEfAvg: number | undefined

  /** 前 4 周平均效率因子 */
  previousEfAvg: number | undefined

  /** 近 4 周 vs 前 4 周效率因子变化（%） */
  efPercentChange: number | undefined

  /** 近 4 周平均 TSS */
  recentTssAvg: number | undefined

  /** 前 4 周平均 TSS */
  previousTssAvg: number | undefined

  /** 近 4 周 vs 前 4 周平均 TSS 变化（%） */
  tssPercentChange: number | undefined

  /** 12 周内单周距离最大的周（无数据时 undefined） */
  bestDistanceWeek: WeekSummary | undefined

  /** 12 周内效率因子最高的周（无数据时 undefined） */
  bestEfWeek: WeekSummary | undefined

  /** 观察窗口内的活跃周数（有一次及以上骑行） */
  activeWeeks: number

  /** 观察窗口内的空周数 */
  idleWeeks: number
}

/**
 * 分析表现趋势序列。
 *
 * @param series 周聚合序列（buildWeeklySeries 输出，按周起点升序）
 * @returns 趋势洞察
 */
export function analyzePerformanceTrend(
  series: readonly WeekSummary[],
): PerformanceTrendInsights {
  const recent = series.slice(-TREND_WINDOW_WEEKS)
  const previous = series.slice(-TREND_WINDOW_WEEKS * 2, -TREND_WINDOW_WEEKS)

  const recentDistanceAvg = averageField(recent, 'distance') ?? 0
  const previousDistanceAvg = averageField(previous, 'distance') ?? 0

  const recentEfAvg = averageField(recent, 'efficiencyFactor')
  const previousEfAvg = averageField(previous, 'efficiencyFactor')
  const recentTssAvg = averageField(recent, 'tss')
  const previousTssAvg = averageField(previous, 'tss')

  let bestDistanceWeek: WeekSummary | undefined
  let bestEfWeek: WeekSummary | undefined
  let activeWeeks = 0
  for (const week of series) {
    if (week.rides > 0) {
      activeWeeks += 1
    }
    if (week.rides > 0 && (bestDistanceWeek === undefined || week.distance > bestDistanceWeek.distance)) {
      bestDistanceWeek = week
    }
    if (
      week.efficiencyFactor !== undefined &&
      (bestEfWeek === undefined ||
        (week.efficiencyFactor as number) > (bestEfWeek.efficiencyFactor as number))
    ) {
      bestEfWeek = week
    }
  }

  return {
    recentDistanceAvg,
    previousDistanceAvg,
    distancePercentChange: percentChange(recentDistanceAvg, previousDistanceAvg),
    recentEfAvg,
    previousEfAvg,
    efPercentChange: percentChange(recentEfAvg, previousEfAvg),
    recentTssAvg,
    previousTssAvg,
    tssPercentChange: percentChange(recentTssAvg, previousTssAvg),
    bestDistanceWeek,
    bestEfWeek,
    activeWeeks,
    idleWeeks: series.length - activeWeeks,
  }
}

/** 百分比变化展品文案（正负符号 + 一位小数） */
export function formatPercentDelta(percent: number | undefined): string | undefined {
  if (percent === undefined) {
    return undefined
  }
  const sign = percent > 0 ? '↑' : '↓'
  return `${sign}${Math.abs(percent).toFixed(1)}%`
}