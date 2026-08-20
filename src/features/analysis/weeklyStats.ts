/**
 * 周度训练聚合（规格 §39 表现趋势 / 每周训练综述）。
 *
 * 表现趋势：按自然周（周一为一周起点）聚合最近 N 周的训练量，
 * 输出连续周序列（含空周，便于图表等宽绘制）；
 * 每周综述：单周聚合 + 与上一周对比。
 *
 * 聚合口径：
 * - 周起点 = 本地时区周一零点，weekStart 键为 YYYY-MM-DD
 * - 效率因子 EF = Σ(NP×时长) / Σ(平均心率×时长)（按时长加权的功率/心率比，
 *   反映单位心跳产生的功率，规格 §39）；仅同时具备功率与心率的活动参与，
 *   无可参与活动时为 undefined（不伪造，规格 §26）
 * - TSS 逐活动现算（同训练状态模块），需要 FTP；无 FTP 时不计算（undefined）
 */
import { calculateIntensityFactor, calculateTss } from '@/features/analysis/intensity'

/**
 * 周度聚合参与活动输入（listAllSummaries 摘要子集）。
 */
export interface WeekActivity {
  /** 开始时间（ISO 8601） */
  startTime: string

  /** 骑行计时时长（秒） */
  duration: number

  /** 总距离（米） */
  distance: number

  /** 累计爬升（米） */
  elevationGain: number

  /** 标准化功率（W；缺失 = 无功率数据，不参与 EF/TSS） */
  normalizedPower?: number

  /** 平均心率（bpm；缺失 = 无心率数据，不参与 EF） */
  avgHeartRate?: number
}

/**
 * 单周聚合结果。
 */
export interface WeekSummary {
  /** 周起点（本地周一零点，YYYY-MM-DD） */
  weekStart: string

  /** 骑行次数 */
  rides: number

  /** 总距离（米） */
  distance: number

  /** 总骑行时长（秒） */
  duration: number

  /** 累计爬升（米） */
  elevationGain: number

  /** 周训练压力（TSS；无 FTP 或无功率数据时为 undefined） */
  tss?: number

  /** 周效率因子（无可参与活动时为 undefined） */
  efficiencyFactor?: number
}

/**
 * 连续周序列聚合（表现趋势）。
 *
 * @param activities 全部活动摘要
 * @param weeks 返回周数（含空周，默认 12）
 * @param ftp 功能阈值功率（W；缺省不计算 TSS）
 * @param now 参考时间（默认当前时间，测试可注入固定时间）
 * @returns 按周起点升序的周聚合序列
 */
export function buildWeeklySeries(
  activities: readonly WeekActivity[],
  weeks = 12,
  ftp?: number,
  now: Date = new Date(),
): WeekSummary[] {
  const byWeek = new Map<string, WeekSummary>()
  // 累加中间量：EF 加权分子（NP×时长）与分母（心率×时长）分别汇总后相除
  const efNumerator = new Map<string, number>()
  const efDenominator = new Map<string, number>()

  for (const activity of activities) {
    const weekStart = weekStartKey(new Date(activity.startTime))
    let summary = byWeek.get(weekStart)
    if (summary === undefined) {
      summary = {
        weekStart,
        rides: 0,
        distance: 0,
        duration: 0,
        elevationGain: 0,
      }
      byWeek.set(weekStart, summary)
    }
    summary.rides += 1
    summary.distance += activity.distance
    summary.duration += activity.duration
    summary.elevationGain += activity.elevationGain

    // EF：仅同时具备 NP 与平均心率的活动参与
    if (activity.normalizedPower !== undefined && activity.avgHeartRate !== undefined) {
      efNumerator.set(weekStart, (efNumerator.get(weekStart) ?? 0) + activity.normalizedPower * activity.duration)
      efDenominator.set(weekStart, (efDenominator.get(weekStart) ?? 0) + activity.avgHeartRate * activity.duration)
    }
    // TSS：NP 存在且 FTP 有效时现算累加
    if (activity.normalizedPower !== undefined && ftp !== undefined && ftp > 0) {
      const intensityFactor = calculateIntensityFactor(activity.normalizedPower, ftp)
      if (intensityFactor !== undefined) {
        const tss = calculateTss(activity.duration, intensityFactor, ftp)
        if (tss !== undefined) {
          summary.tss = (summary.tss ?? 0) + tss
        }
      }
    }
  }

  for (const [weekStart, summary] of byWeek) {
    const numerator = efNumerator.get(weekStart)
    const denominator = efDenominator.get(weekStart)
    if (numerator !== undefined && denominator !== undefined && denominator > 0) {
      summary.efficiencyFactor = numerator / denominator
    }
  }

  const result: WeekSummary[] = []
  const [endYear, endMonth, endDay] = weekStartKey(now).split('-').map(Number)
  for (let i = weeks - 1; i >= 0; i--) {
    const cursor = new Date(endYear, endMonth - 1, endDay)
    cursor.setDate(cursor.getDate() - i * 7)
    const key = weekStartKey(cursor)
    result.push(byWeek.get(key) ?? { weekStart: key, rides: 0, distance: 0, duration: 0, elevationGain: 0 })
  }
  return result
}

/**
 * 每周综述：指定周聚合 + 与上一周对比。
 *
 * @param activities 全部活动摘要
 * @param weekStart 目标周起点（YYYY-MM-DD，本地周一零点）
 * @param ftp 功能阈值功率（W；缺省不计算 TSS）
 * @returns 目标周与上一周聚合；目标周无数据时仍返回（rides 为 0）
 */
export function buildWeekReview(
  activities: readonly WeekActivity[],
  weekStart: string,
  ftp?: number,
): { current: WeekSummary; previous: WeekSummary } {
  const target = weekStartKey(new Date(`${weekStart}T00:00:00`))
  const [year, month, day] = target.split('-').map(Number)
  const previousCursor = new Date(year, month - 1, day)
  previousCursor.setDate(previousCursor.getDate() - 7)
  const previous = weekStartKey(previousCursor)

  const current = summarizeWeek(activities, target, ftp)
  const previousSummary = summarizeWeek(activities, previous, ftp)
  return { current, previous: previousSummary }
}

/**
 * 聚合指定周（weekStart 键精确匹配，无数据返回零值周）。
 *
 * @param activities 全部活动摘要
 * @param weekStart 周起点键（YYYY-MM-DD）
 * @param ftp 功能阈值功率（W）
 * @returns 该周聚合
 */
function summarizeWeek(
  activities: readonly WeekActivity[],
  weekStart: string,
  ftp?: number,
): WeekSummary {
  return buildWeeklySeries(activities, 1, ftp, new Date(`${weekStart}T00:00:00`))[0]
}

/**
 * 本地时区周起点键（周一零点，YYYY-MM-DD）。
 * 用本地日期分量回退，避开 DST 平移导致的毫秒误差。
 *
 * @param date 日期
 * @returns 如 "2026-08-17"
 */
export function weekStartKey(date: Date): string {
  // getDay(): 0=周日 → 6=周六；回退 (getDay()+6)%7 天到周一
  const day = (date.getDay() + 6) % 7
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}