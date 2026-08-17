/**
 * 训练状态（Fitness / Fatigue / Form）计算（规格 §39 P2）。
 *
 * 标准模型（TrainingPeaks / Banister）：
 * - 每日 TSS：由活动标准化功率与当前 FTP 现算（NP 原始、TSS 随 FTP 调整自动重算）
 * - CTL（Fitness）= 每日 TSS 的 42 天指数加权平均
 * - ATL（Fatigue）= 每日 TSS 的 7 天指数加权平均
 * - TSB（Form）= 前一日 CTL − 前一日 ATL
 *
 * 无 FTP 配置或无功率数据的活动不参与计算（不伪造，规格 §26）；
 * NP 缺失的历史活动由调用方回填后再计算。
 */
import { calculateIntensityFactor, calculateTss } from '@/features/analysis/intensity'

/** CTL 指数加权时间常数（天） */
export const CTL_TIME_CONSTANT_DAYS = 42

/** ATL 指数加权时间常数（天） */
export const ATL_TIME_CONSTANT_DAYS = 7

/**
 * 训练状态单日数据点。
 */
export interface TrainingStatusPoint {
  /** 本地日期键（YYYY-MM-DD） */
  date: string

  /** 长期训练负荷（Fitness） */
  ctl: number

  /** 短期训练负荷（Fatigue） */
  atl: number

  /** 状态（Form = 前一日 CTL − ATL） */
  tsb: number
}

/**
 * 参与 TSS 聚合的活动输入（listAllSummaries 摘要子集）。
 */
export interface TssActivity {
  /** 开始时间（ISO 8601） */
  startTime: string

  /** 骑行计时时长（秒） */
  duration: number

  /** 标准化功率（W；缺失 = 无功率数据，不参与） */
  normalizedPower?: number
}

/**
 * 聚合每日 TSS：同一自然日多次活动累加，无 NP 的活动跳过。
 *
 * @param activities 全部活动摘要
 * @param ftp 功能阈值功率（W）
 * @returns 本地日期键 → 当日 TSS
 */
export function buildDailyTss(
  activities: readonly TssActivity[],
  ftp: number,
): Map<string, number> {
  const daily = new Map<string, number>()
  for (const activity of activities) {
    if (activity.normalizedPower === undefined) {
      continue
    }
    const intensityFactor = calculateIntensityFactor(activity.normalizedPower, ftp)
    const tss =
      intensityFactor === undefined
        ? undefined
        : calculateTss(activity.duration, intensityFactor, ftp)
    if (tss === undefined) {
      continue
    }
    const dateKey = localDateKey(new Date(activity.startTime))
    daily.set(dateKey, (daily.get(dateKey) ?? 0) + tss)
  }
  return daily
}

/**
 * 计算训练状态序列：从首个有 TSS 的日期迭代至参考日，EWMA 递推 CTL/ATL。
 * 返回最后 days 天的数据点；无任何 TSS 数据时返回空数组。
 *
 * @param dailyTss 每日 TSS（buildDailyTss 输出）
 * @param days 返回的天数（默认 90）
 * @param now 参考时间（默认当前时间，测试可注入固定时间）
 * @returns 按日期升序的训练状态点
 */
export function buildTrainingStatus(
  dailyTss: ReadonlyMap<string, number>,
  days = 90,
  now: Date = new Date(),
): TrainingStatusPoint[] {
  if (dailyTss.size === 0 || days <= 0) {
    return []
  }

  // 迭代起点：首个 TSS 日期的本地零点
  const firstDate = [...dailyTss.keys()].sort()[0]
  const [year, month, day] = firstDate.split('-').map(Number)
  const endMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

  const points: TrainingStatusPoint[] = []
  let ctl = 0
  let atl = 0
  // 用本地日期分量逐日推进，避开 DST 平移导致的毫秒误差（同 buildYearGrid）
  for (
    let cursor = new Date(year, month - 1, day);
    cursor.getTime() <= endMs;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  ) {
    const dateKey = localDateKey(cursor)
    const tss = dailyTss.get(dateKey) ?? 0
    // 当日 TSB 使用前一日负荷（TrainingPeaks 口径）
    const tsb = ctl - atl
    ctl += (tss - ctl) / CTL_TIME_CONSTANT_DAYS
    atl += (tss - atl) / ATL_TIME_CONSTANT_DAYS
    points.push({ date: dateKey, ctl, atl, tsb })
  }
  return points.slice(-days)
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
