/**
 * 仪表盘统计聚合（规格 §13）。
 *
 * 纯函数：输入 listAllSummaries() 输出的摘要列表，输出本周/本月/总计聚合
 * 与多粒度距离趋势序列，供仪表盘与后续统计页复用。
 *
 * 时间口径：
 * - 所有归组基于本地时区（startTime 解析为本地时间后取年月日）
 * - 本周 = 本周一 00:00 至 now；本月 = 本月 1 号 00:00 至 now
 * - 趋势序列以今天为终点，向前补足 N 天，无活动天距离补 0
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/**
 * 时间段聚合结果。
 */
export interface PeriodSummary {
  /** 活动次数 */
  count: number

  /** 总距离（米） */
  totalDistance: number

  /** 总骑行时长（秒） */
  totalDuration: number

  /** 总累计爬升（米） */
  totalElevationGain: number
}

/**
 * 单日距离数据点（趋势序列）。
 */
export interface DailyDistance {
  /** 本地日期（YYYY-MM-DD） */
  date: string

  /** 当日总距离（米） */
  distance: number
}

/**
 * 距离趋势序列（按天聚合，无活动补零）。
 */
export interface TrendSeries {
  /** 过去 30 天（含今天，共 30 点） */
  days30: DailyDistance[]

  /** 过去 90 天（含今天，共 90 点） */
  days90: DailyDistance[]

  /** 过去一年（365/366 天，含今天） */
  year: DailyDistance[]
}

/**
 * 仪表盘聚合数据（页面与统计页复用）。
 */
export interface DashboardData {
  /** 本周（周一至今天） */
  week: PeriodSummary

  /** 本月（1 号至今天） */
  month: PeriodSummary

  /** 全部活动累计 */
  total: PeriodSummary

  /** 距离趋势序列 */
  trends: TrendSeries

  /** 最近骑行（startTime 降序，最多 RECENT_RIDES_COUNT 条） */
  recentActivities: ActivitySummary[]

  /** 是否有活动数据（空状态判断） */
  hasData: boolean
}

/** 仪表盘「最近骑行」展示条数 */
export const RECENT_RIDES_COUNT = 5

/** 趋势粒度键（days30 / days90 / year） */
export type TrendKey = 'days30' | 'days90' | 'year'

/** 趋势粒度 → 天数（含今天） */
const TREND_DAYS: Record<TrendKey, number> = { days30: 30, days90: 90, year: 365 }

/** 空聚合值（无活动时的时间段默认） */
const EMPTY_SUMMARY: PeriodSummary = {
  count: 0,
  totalDistance: 0,
  totalDuration: 0,
  totalElevationGain: 0,
}

/**
 * 生成仪表盘聚合数据。
 *
 * @param summaries 全部活动摘要（listAllSummaries 输出，不依赖排序）
 * @param now 参考时间（默认当前时间，测试可注入固定时间）
 * @returns 周/月/总聚合与趋势序列
 */
export function buildDashboardData(summaries: ActivitySummary[], now: Date = new Date()): DashboardData {
  const week = { ...EMPTY_SUMMARY }
  const month = { ...EMPTY_SUMMARY }
  const total = { ...EMPTY_SUMMARY }

  const weekStart = startOfWeek(now)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nowMs = now.getTime()

  // 单次遍历同时归组周/月/总三个区间（按 startTime 归属，未来活动不计入周/月）
  for (const activity of summaries) {
    const startMs = new Date(activity.startTime).getTime()
    if (startMs >= weekStart.getTime() && startMs <= nowMs) {
      addToSummary(week, activity)
    }
    if (startMs >= monthStart.getTime() && startMs <= nowMs) {
      addToSummary(month, activity)
    }
    addToSummary(total, activity)
  }

  return {
    week,
    month,
    total,
    trends: {
      days30: buildDailySeries(summaries, TREND_DAYS.days30, now),
      days90: buildDailySeries(summaries, TREND_DAYS.days90, now),
      year: buildDailySeries(summaries, TREND_DAYS.year, now),
    },
    recentActivities: buildRecentActivities(summaries),
    hasData: summaries.length > 0,
  }
}

/**
 * 提取最近骑行摘要：按 startTime 降序，无效时间戳剔除，截取前 N 条。
 *
 * @param summaries 活动摘要列表（顺序任意）
 * @param count 展示条数
 * @returns 最近的最多 count 条活动
 */
function buildRecentActivities(
  summaries: ActivitySummary[],
  count: number = RECENT_RIDES_COUNT,
): ActivitySummary[] {
  return summaries
    .filter((activity) => !Number.isNaN(new Date(activity.startTime).getTime()))
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, count)
}

/**
 * 将活动累加到时间段聚合中。
 *
 * @param summary 目标聚合（原地累加）
 * @param activity 活动摘要
 */
function addToSummary(summary: PeriodSummary, activity: ActivitySummary): void {
  summary.count += 1
  summary.totalDistance += activity.distance
  summary.totalDuration += activity.duration
  summary.totalElevationGain += activity.elevationGain
}

/**
 * 计算日期所在周的周一（本地时区 00:00）。
 * getDay() 返回 0（周日）~ 6（周六），周一偏移量 = 周日 6 / 其余 day-1。
 *
 * @param date 参考日期
 * @returns 本周一 00:00
 */
function startOfWeek(date: Date): Date {
  const day = date.getDay()
  const sinceMonday = day === 0 ? 6 : day - 1
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday)
}

/**
 * 本地时区日期键（YYYY-MM-DD，两位补零）。
 *
 * @param date 日期
 * @returns 如 "2026-08-17"
 */
function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 构建 N 天距离序列：以今天为终点，向前补足 days 天，无活动天补 0。
 * 跨月/跨年边界由 Date 算术天然处理（如 1 月初的序列起点在上一年）。
 *
 * @param summaries 活动摘要列表
 * @param days 序列天数（含今天）
 * @param now 参考时间
 * @returns 升序排列的每日距离
 */
function buildDailySeries(summaries: ActivitySummary[], days: number, now: Date): DailyDistance[] {
  // 按本地日期键归组距离（同日多活动累加）
  const distanceByDate = new Map<string, number>()
  for (const activity of summaries) {
    const dateKey = localDateKey(new Date(activity.startTime))
    distanceByDate.set(dateKey, (distanceByDate.get(dateKey) ?? 0) + activity.distance)
  }

  // 序列范围：[今天 - (days-1), 今天]
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1))

  const series: DailyDistance[] = []
  for (let i = 0; i < days; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const dateKey = localDateKey(date)
    series.push({ date: dateKey, distance: distanceByDate.get(dateKey) ?? 0 })
  }
  return series
}
