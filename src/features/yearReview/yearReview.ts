/**
 * 年度回顾纯函数（后续工作项：年度回顾）。
 *
 * 从活动摘要中提取有数据的年份列表、按年聚合月度距离，
 * 页面层复用 buildStatistics 计算年度总指标。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/** 一年 12 个月 */
const MONTHS_PER_YEAR = 12

/**
 * 月度聚合条目。
 */
export interface MonthlyDistance {
  /** 月份（1-12，本地时区） */
  month: number

  /** 当月总距离（米） */
  distance: number

  /** 当月骑行次数 */
  count: number
}

/**
 * 提取有骑行记录的年份（降序，最新在前）。
 *
 * @param summaries 全部活动摘要
 * @returns 年份列表（如 [2026, 2025]）；无数据返回空数组
 */
export function extractYears(summaries: readonly ActivitySummary[]): number[] {
  const years = new Set<number>()
  for (const activity of summaries) {
    const time = new Date(activity.startTime).getTime()
    if (Number.isNaN(time)) {
      continue
    }
    years.add(new Date(activity.startTime).getFullYear())
  }
  return [...years].sort((a, b) => b - a)
}

/**
 * 按年聚合月度距离/次数（本地时区，1-12 月齐全，无数据月为 0）。
 *
 * @param summaries 全部活动摘要
 * @param year 目标年份
 * @returns 12 个月的聚合条目
 */
export function buildMonthlyDistances(
  summaries: readonly ActivitySummary[],
  year: number,
): MonthlyDistance[] {
  const months: MonthlyDistance[] = Array.from({ length: MONTHS_PER_YEAR }, (_, index) => ({
    month: index + 1,
    distance: 0,
    count: 0,
  }))

  for (const activity of summaries) {
    const start = new Date(activity.startTime)
    if (Number.isNaN(start.getTime()) || start.getFullYear() !== year) {
      continue
    }
    const entry = months[start.getMonth()]
    entry.distance += activity.distance
    entry.count += 1
  }
  return months
}

/**
 * 构造某年的自定义统计范围（YYYY-01-01 ~ YYYY-12-31，供 buildStatistics 使用）。
 *
 * @param year 目标年份
 * @returns 自定义范围（含边界日）
 */
export function yearRange(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` }
}
