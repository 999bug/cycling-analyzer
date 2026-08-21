/**
 * 统计页聚合纯函数（规格 §28）。
 *
 * 输入 listAllSummaries() 输出的摘要列表与时间范围，输出十项统计指标，
 * 供统计页与后续页面复用（日历、趋势等页面可基于相同范围口径扩展）。
 *
 * 时间口径（与仪表盘 buildDashboardData 一致）：
 * - 所有归组基于本地时区（startTime 解析为本地时间后取年月日）
 * - 本周 = 本周一 00:00 至 now；本月 = 本月 1 号 00:00 至 now
 * - 今年 = 1 月 1 日 00:00 至 now；过去 12 个月 = 12 个月前今天 00:00 至 now
 * - 自定义 = 起止日期整天（含边界日，本地时区）
 * - 预设范围上界为 now（未来开始的活动不计入）；全部无上界
 *
 * 指标口径（规格 §28）：
 * - 平均单次距离 = 总距离 / 次数
 * - 平均速度 = 总距离 / 总时长（m/s）
 * - 最长骑行 / 单次最大爬升 / 最快速度 / 最高功率 = 范围内单次最大值
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/**
 * 统计范围键（规格 §28）。
 */
export type RangeKey = 'week' | 'month' | 'year' | 'last12Months' | 'all' | 'custom'

/**
 * 自定义日期范围（YYYY-MM-DD，本地时区，含边界日）。
 */
export interface CustomRange {
  /** 起始日期（YYYY-MM-DD，含当天） */
  start: string

  /** 结束日期（YYYY-MM-DD，含当天） */
  end: string
}

/**
 * 解析后的时间范围（本地时区毫秒，闭区间）。
 */
export interface DateRange {
  /** 起始毫秒（含） */
  startMs: number

  /** 结束毫秒（含）；null 表示无上界（全部） */
  endMs: number | null
}

/**
 * 统计指标（规格 §28）。
 */
export interface StatisticsMetrics {
  /** 活动次数 */
  count: number

  /** 总距离（米） */
  totalDistance: number

  /** 总骑行时长（秒） */
  totalDuration: number

  /** 总累计爬升（米） */
  totalElevationGain: number

  /** 平均单次距离（米） */
  avgRideDistance: number

  /** 平均速度（m/s） */
  avgSpeed: number

  /** 最长单次骑行距离（米） */
  longestRide: number

  /** 单次最大爬升（米） */
  maxElevationGain: number

  /** 最快速度（m/s） */
  maxSpeed: number

  /** 最高功率（W），范围内无任何功率数据时为 undefined（规格 §25） */
  maxPower: number | undefined
}

/** 范围键 → 中文标签（选择器选项文本，顺序即选择器展示顺序） */
export const RANGE_LABELS: Record<RangeKey, string> = {
  week: '本周',
  month: '本月',
  year: '今年',
  last12Months: '过去 12 个月',
  all: '全部',
  custom: '自定义',
}

/** 无上界范围（全部：从 1970 年起，无结束上限） */
const ALL_RANGE: DateRange = { startMs: 0, endMs: null }

/** 空范围（自定义输入无效时的兜底，任何活动都无法命中） */
const EMPTY_RANGE: DateRange = { startMs: 0, endMs: 0 }

/** 空指标默认值（无活动时的聚合结果） */
const EMPTY_METRICS: StatisticsMetrics = {
  count: 0,
  totalDistance: 0,
  totalDuration: 0,
  totalElevationGain: 0,
  avgRideDistance: 0,
  avgSpeed: 0,
  longestRide: 0,
  maxElevationGain: 0,
  maxSpeed: 0,
  maxPower: undefined,
}

/**
 * 将范围键解析为本地时区毫秒闭区间。
 * 自定义输入无效（格式错误、日期溢出、结束早于开始）时返回空范围。
 *
 * @param key 范围键
 * @param now 参考时间（默认当前时间，测试可注入固定时间）
 * @param custom 自定义范围（key 为 custom 时必填）
 * @returns 解析后的时间范围
 */
export function resolveRange(key: RangeKey, now: Date = new Date(), custom?: CustomRange): DateRange {
  const nowMs = now.getTime()
  switch (key) {
    case 'week':
      return { startMs: startOfWeek(now).getTime(), endMs: nowMs }
    case 'month':
      return { startMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), endMs: nowMs }
    case 'year':
      return { startMs: new Date(now.getFullYear(), 0, 1).getTime(), endMs: nowMs }
    case 'last12Months':
      return { startMs: new Date(now.getFullYear(), now.getMonth() - 12, now.getDate()).getTime(), endMs: nowMs }
    case 'all':
      return ALL_RANGE
    case 'custom':
      return resolveCustomRange(custom)
  }
}

/**
 * 解析自定义日期范围：起始日 00:00 至结束日 24:00 前一毫秒（含整天）。
 *
 * @param custom 自定义范围（YYYY-MM-DD）
 * @returns 解析后的时间范围，无效输入返回空范围
 */
function resolveCustomRange(custom?: CustomRange): DateRange {
  if (custom == null) {
    return EMPTY_RANGE
  }
  const start = parseDateKey(custom.start)
  const end = parseDateKey(custom.end)
  if (start == null || end == null || end.getTime() < start.getTime()) {
    return EMPTY_RANGE
  }
  return {
    startMs: start.getTime(),
    // 结束日 +1 天 00:00 前一毫秒 = 结束日 23:59:59.999（含边界日整天）
    endMs: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime() - 1,
  }
}

/**
 * 解析 YYYY-MM-DD 日期键为本地时区 00:00 的 Date。
 * 用 round-trip 校验拒绝溢出日期（如 2026-02-31 会溢出为 3 月 3 日）。
 *
 * @param value 日期键（YYYY-MM-DD）
 * @returns 本地时间 Date，无效输入返回 null
 */
function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match == null) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
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
 * 聚合指定时间范围内的统计指标。
 * 单次遍历完成累加与最大值追踪；平均单次距离与平均速度为派生值，无活动时为 0。
 *
 * @param summaries 活动摘要列表（listAllSummaries 输出，不依赖排序）
 * @param range 时间范围（resolveRange 输出）
 * @returns 统计指标
 */
export function buildStatistics(summaries: ActivitySummary[], range: DateRange): StatisticsMetrics {
  const metrics = { ...EMPTY_METRICS }
  for (const activity of summaries) {
    const startMs = new Date(activity.startTime).getTime()
    if (Number.isNaN(startMs)) {
      continue
    }
    if (startMs < range.startMs || (range.endMs !== null && startMs > range.endMs)) {
      continue
    }

    metrics.count += 1
    metrics.totalDistance += activity.distance
    metrics.totalDuration += activity.duration
    metrics.totalElevationGain += activity.elevationGain
    if (activity.distance > metrics.longestRide) {
      metrics.longestRide = activity.distance
    }
    if (activity.elevationGain > metrics.maxElevationGain) {
      metrics.maxElevationGain = activity.elevationGain
    }
    if (activity.maxSpeed !== undefined && activity.maxSpeed > metrics.maxSpeed) {
      metrics.maxSpeed = activity.maxSpeed
    }
    // 功率缺失 = undefined ≠ 0：仅活动自身携带功率时才参与比较（规格 §25）
    if (
      activity.maxPower !== undefined &&
      (metrics.maxPower === undefined || activity.maxPower > metrics.maxPower)
    ) {
      metrics.maxPower = activity.maxPower
    }
  }

  if (metrics.count > 0) {
    metrics.avgRideDistance = metrics.totalDistance / metrics.count
  }
  if (metrics.totalDuration > 0) {
    metrics.avgSpeed = metrics.totalDistance / metrics.totalDuration
  }
  return metrics
}
