/**
 * 日历聚合纯函数（规格 §29）。
 *
 * 输入 listAllSummaries() 输出的摘要列表，输出按本地日期归组的
 * 每日聚合 Map，以及年网格、颜色档位、工具提示等渲染辅助纯函数。
 *
 * 时间口径：
 * - 归组基于本地时区（startTime 解析为本地时间后取年月日）
 * - 年网格每周一行、周日起始，首行从 1 月 1 日所在周开始，
 *   末行到 12 月 31 日所在周结束，跨年边缘含相邻年日期
 * - 未来活动（startTime 晚于 now）不进入聚合
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { formatDuration, formatElevation, localDateKey } from '@/utils/format'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'

/** 档位 2 距离阈值：20 km（米） */
export const LEVEL_2_DISTANCE = 20_000

/** 档位 3 距离阈值：50 km（米） */
export const LEVEL_3_DISTANCE = 50_000

/** 档位 4 距离阈值：100 km（米） */
export const LEVEL_4_DISTANCE = 100_000

/**
 * 颜色档位（0 无骑行 ~ 4 最高强度，规格 §29 五档距离区间）。
 */
export type IntensityLevel = 0 | 1 | 2 | 3 | 4

/**
 * 单日聚合结果。
 *
 * 可选字段遵循「缺失 = undefined ≠ 0」口径（规格 §25）：
 * 当日所有活动均无该项数据时为 undefined，工具提示中对应行不显示。
 */
export interface DayActivitySummary {
  /** 当日骑行次数 */
  count: number

  /** 当日总距离（米） */
  distance: number

  /** 当日总骑行时长（秒） */
  duration: number

  /** 当日总累计爬升（米）；当日全部活动无海拔数据时为 undefined */
  elevationGain?: number

  /** 当日均速（m/s，按活动时长加权）；当日无任何速度数据时为 undefined */
  avgSpeed?: number

  /** 当日平均心率（bpm，按活动时长加权）；当日无任何心率数据时为 undefined */
  avgHeartRate?: number

  /** 当日平均功率（W，按活动时长加权）；当日无任何功率数据时为 undefined */
  avgPower?: number
}

/** buildCalendarData 内部累加器：在 DayActivitySummary 基础上追踪加权求和与样本权重 */
interface DayAccumulator {
  count: number
  distance: number
  duration: number
  elevationGain: number
  elevationDays: number
  speedWeightedSum: number
  speedWeight: number
  heartRateWeightedSum: number
  heartRateWeight: number
  powerWeightedSum: number
  powerWeight: number
}

/**
 * 日历聚合数据：本地日期键（YYYY-MM-DD）→ 当日聚合。
 */
export type CalendarData = Map<string, DayActivitySummary>

/**
 * 年网格单元格。
 */
export interface CalendarCell {
  /** 本地日期键（YYYY-MM-DD） */
  dateKey: string

  /** 是否属于当前展示年（网格边缘含相邻年日期） */
  inYear: boolean

  /** 当日聚合（无活动时为 null） */
  summary: DayActivitySummary | null
}

/**
 * 按本地日期归组聚合每日骑行数据。
 * 同一自然日多次活动合并累加；开始时间晚于 now 的活动不计入（未来数据不入图）。
 *
 * @param summaries 全部活动摘要（listAllSummaries 输出，不依赖排序）
 * @param now 参考时间（默认当前时间，测试可注入固定时间）
 * @returns 本地日期键 → 当日聚合的 Map
 */
export function buildCalendarData(
  summaries: ActivitySummary[],
  now: Date = new Date(),
): CalendarData {
  const data = new Map<string, DayAccumulator>()
  const nowMs = now.getTime()

  for (const activity of summaries) {
    const startMs = new Date(activity.startTime).getTime()
    if (startMs > nowMs) {
      continue
    }
    const dateKey = localDateKey(new Date(activity.startTime))
    let entry = data.get(dateKey)
    if (entry === undefined) {
      entry = {
        count: 0,
        distance: 0,
        duration: 0,
        elevationGain: 0,
        elevationDays: 0,
        speedWeightedSum: 0,
        speedWeight: 0,
        heartRateWeightedSum: 0,
        heartRateWeight: 0,
        powerWeightedSum: 0,
        powerWeight: 0,
      }
      data.set(dateKey, entry)
    }
    entry.count += 1
    entry.distance += activity.distance
    entry.duration += activity.duration
    // 无海拔数据源（行者 GPX）爬升为 undefined：任一活动带爬升即有值，
    // 全部缺失则最终 undefined（tooltip 隐藏爬升行）
    if (activity.elevationGain !== undefined) {
      entry.elevationGain += activity.elevationGain
      entry.elevationDays += 1
    }
    // 均速/心率/功率按活动时长加权平均：时长长的活动对当日均值贡献更大
    if (activity.avgSpeed !== undefined && activity.duration > 0) {
      entry.speedWeightedSum += activity.avgSpeed * activity.duration
      entry.speedWeight += activity.duration
    }
    if (activity.avgHeartRate !== undefined && activity.duration > 0) {
      entry.heartRateWeightedSum += activity.avgHeartRate * activity.duration
      entry.heartRateWeight += activity.duration
    }
    if (activity.avgPower !== undefined && activity.duration > 0) {
      entry.powerWeightedSum += activity.avgPower * activity.duration
      entry.powerWeight += activity.duration
    }
  }

  // 累加器 → 对外聚合：加权均值样本权重为 0（当日无数据）时输出 undefined
  const result = new Map<string, DayActivitySummary>()
  for (const [dateKey, acc] of data) {
    result.set(dateKey, {
      count: acc.count,
      distance: acc.distance,
      duration: acc.duration,
      elevationGain: acc.elevationDays > 0 ? acc.elevationGain : undefined,
      avgSpeed: acc.speedWeight > 0 ? acc.speedWeightedSum / acc.speedWeight : undefined,
      avgHeartRate:
        acc.heartRateWeight > 0 ? acc.heartRateWeightedSum / acc.heartRateWeight : undefined,
      avgPower: acc.powerWeight > 0 ? acc.powerWeightedSum / acc.powerWeight : undefined,
    })
  }
  return result
}

/**
 * 计算指定年份的日历网格：每周一行（周日起始），每行 7 格。
 * 首行从 1 月 1 日所在周的周日开始，末行到 12 月 31 日所在周的周六结束，
 * 跨年边缘的格子 inYear 为 false。
 *
 * @param year 年份
 * @param data 聚合数据（buildCalendarData 输出）
 * @returns 网格行（周）列表，每行 7 个单元格
 */
export function buildYearGrid(year: number, data: CalendarData): CalendarCell[][] {
  const jan1 = new Date(year, 0, 1)
  const dec31 = new Date(year, 11, 31)
  // 首行周日 = 1 月 1 日前推 getDay() 天；末行周六 = 12 月 31 日后推 6 - getDay() 天
  const first = new Date(year, 0, 1 - jan1.getDay())
  const last = new Date(year, 11, 31 + (6 - dec31.getDay()))

  const grid: CalendarCell[][] = []
  let weekStart = new Date(first)
  while (weekStart <= last) {
    const row: CalendarCell[] = []
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset)
      const dateKey = localDateKey(date)
      row.push({
        dateKey,
        inYear: date.getFullYear() === year,
        summary: data.get(dateKey) ?? null,
      })
    }
    grid.push(row)
    // 用本地日期分量构造下一周起点，避开 DST 平移导致的毫秒误差
    weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7)
  }
  return grid
}

/**
 * 按当日总距离计算颜色档位（规格 §29）：
 * 0 / <20km / <50km / <100km / ≥100km 五档。
 *
 * @param distanceMeters 当日总距离（米）
 * @returns 档位 0（无骑行）~ 4（≥100 km）
 */
export function intensityLevel(distanceMeters: number): IntensityLevel {
  if (distanceMeters >= LEVEL_4_DISTANCE) {
    return 4
  }
  if (distanceMeters >= LEVEL_3_DISTANCE) {
    return 3
  }
  if (distanceMeters >= LEVEL_2_DISTANCE) {
    return 2
  }
  if (distanceMeters > 0) {
    return 1
  }
  return 0
}

/**
 * 工具提示行（label + value 成对展示）。
 */
export interface DayTooltipRow {
  /** 指标名（如 "距离"） */
  label: string

  /** 格式化后的值（如 "127.40 km"） */
  value: string
}

/**
 * 工具提示内容（规格 §29 悬浮详情）：
 * 标题为日期 + 骑行次数，行按 距离/时长/爬升/均速/心率/功率 顺序排列；
 * 缺失的指标（undefined）不生成对应行（规格 §25 缺失≠0，不显示 —）。
 *
 * @param dateKey 本地日期键（YYYY-MM-DD）
 * @param summary 当日聚合
 * @param distanceUnit 距离/速度显示单位（缺省公里）
 * @returns 标题与指标行列表
 */
export function buildDayTooltipRows(
  dateKey: string,
  summary: DayActivitySummary,
  distanceUnit: DistanceUnit = 'km',
): { title: string; rows: DayTooltipRow[] } {
  const rows: DayTooltipRow[] = [
    { label: '距离', value: formatDistanceByUnit(summary.distance, distanceUnit) },
    { label: '时长', value: formatDuration(summary.duration) },
  ]
  if (summary.elevationGain !== undefined) {
    rows.push({ label: '爬升', value: formatElevation(summary.elevationGain) })
  }
  if (summary.avgSpeed !== undefined) {
    rows.push({ label: '均速', value: formatSpeedByUnit(summary.avgSpeed, distanceUnit) })
  }
  if (summary.avgHeartRate !== undefined) {
    rows.push({ label: '心率', value: `${Math.round(summary.avgHeartRate)} bpm` })
  }
  if (summary.avgPower !== undefined) {
    rows.push({ label: '功率', value: `${Math.round(summary.avgPower)} W` })
  }
  return { title: `${dateKey} · ${summary.count} 次骑行`, rows }
}

/**
 * 月份标签（横排布局用）：每周一列，该周含当年某月 1 日时标记「M月」。
 */
export interface MonthLabel {
  /** 周（列）下标，从 0 开始 */
  weekIndex: number

  /** 标签文本（如 "3月"） */
  label: string
}

/**
 * 计算年网格的月份标签位置（对齐 GitHub 贡献图：每月 1 日所在周的列上方标注）。
 *
 * @param grid 年网格（buildYearGrid 输出）
 * @returns 月份标签列表（按周下标升序，一年 12 个）
 */
export function buildMonthLabels(grid: CalendarCell[][]): MonthLabel[] {
  const labels: MonthLabel[] = []
  grid.forEach((week, weekIndex) => {
    const firstOfMonth = week.find((cell) => cell.inYear && cell.dateKey.endsWith('-01'))
    if (firstOfMonth !== undefined) {
      labels.push({ weekIndex, label: `${Number(firstOfMonth.dateKey.slice(5, 7))}月` })
    }
  })
  return labels
}

/**
 * 年度汇总（日历页统计卡片，UI-4 填充下半屏留白）。
 */
export interface YearSummary {
  /** 骑行天数（有活动的自然日数） */
  rideDays: number

  /** 活动总次数 */
  count: number

  /** 总距离（米） */
  distance: number

  /** 总时长（秒） */
  duration: number

  /** 总累计爬升（米） */
  elevationGain: number

  /** 单日最长距离（米） */
  longestDayDistance: number
}

/**
 * 汇总指定年份的全部骑行数据（本地时区归组）。
 *
 * @param year 年份
 * @param data 聚合数据（buildCalendarData 输出）
 * @returns 年度汇总（无活动时各值为 0）
 */
export function buildYearSummary(year: number, data: CalendarData): YearSummary {
  const summary: YearSummary = {
    rideDays: 0,
    count: 0,
    distance: 0,
    duration: 0,
    elevationGain: 0,
    longestDayDistance: 0,
  }
  for (const [dateKey, day] of data) {
    if (Number(dateKey.slice(0, 4)) !== year) {
      continue
    }
    summary.rideDays += 1
    summary.count += day.count
    summary.distance += day.distance
    summary.duration += day.duration
    summary.elevationGain += day.elevationGain ?? 0
    if (day.distance > summary.longestDayDistance) {
      summary.longestDayDistance = day.distance
    }
  }
  return summary
}

/**
 * 本地时区日期键（YYYY-MM-DD，两位补零）。
 *
 * @param date 日期
 * @returns 如 "2026-08-17"
 */
// localDateKey 抽到 @/utils/format 共享（保持 re-export 以便老调用方不破）
export { localDateKey }
