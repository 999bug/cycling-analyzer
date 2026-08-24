/**
 * 有氧效率月度趋势（无功率计场景：速度/心率比，规格外延需求）。
 *
 * 有氧效率（Aerobic Efficiency, AE）= 平均速度 ÷ 平均心率。
 * 同样心率下骑得越快，有氧能力越好；不依赖功率计，
 * 适合只有心率带 + GPS 表的轻装场景。
 *
 * 聚合口径：
 * - 按自然月（本地时区，YYYY-MM 键）聚合最近 N 个月
 * - AE = Σ(平均速度×骑行时长) ÷ Σ(平均心率×骑行时长)，按时长加权
 *   （等价于「总距离 ÷ 总时长」与「加权平均心率」之比）
 * - 仅同时具备平均速度与平均心率的活动参与；无可参与活动时为 undefined
 *   （不伪造数据）；空月份 value=undefined，图表断线展示
 */
import type { Activity } from '@/types/activity'

/** 参与月度聚合的活动摘要输入（Activity 子集）。 */
export interface AerobicEfficiencyInput {
  /** 开始时间（ISO 8601 或 Unix 秒均可由 new Date 解析的格式） */
  startTime: Activity['startTime']

  /** 骑行计时时长（秒） */
  duration: number

  /** 平均速度（m/s；缺失 = 不参与） */
  avgSpeed?: number

  /** 平均心率（bpm；缺失 = 不参与） */
  avgHeartRate?: number
}

/**
 * 单月有氧效率聚合结果。
 */
export interface MonthlyAerobicEfficiency {
  /** 月键（YYYY-MM，本地时区） */
  month: string

  /** 该月有氧效率（m/s/bpm）；无可参与活动时为 undefined（空月/缺心率不伪造） */
  value?: number
}

/**
 * 本地时区月份键。
 *
 * @param date 日期
 * @returns 如 "2026-08"
 */
function monthKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/**
 * 构造连续 N 个月的有氧效率序列。
 *
 * 序列按月升序、长度恒为 months（含活动范围外的空月），
 * 空月或该月无可参与活动时 value=undefined，图表据此断线。
 *
 * @param activities 全部活动摘要（只需 startTime/duration/avgSpeed/avgHeartRate）
 * @param months 返回月数（默认 12）
 * @param now 参考时间（默认当前时间，测试可注入固定时间）
 * @returns 按月升序的月度聚合序列
 */
export function buildMonthlyAerobicEfficiency(
  activities: readonly AerobicEfficiencyInput[],
  months = 12,
  now: Date = new Date(),
): MonthlyAerobicEfficiency[] {
  // 累加中间量：分子（速度×时长）与分母（心率×时长）分别汇总后相除
  const numerator = new Map<string, number>()
  const denominator = new Map<string, number>()

  for (const activity of activities) {
    if (activity.avgSpeed === undefined || activity.avgHeartRate === undefined) {
      continue
    }
    const key = monthKey(new Date(activity.startTime))
    numerator.set(key, (numerator.get(key) ?? 0) + activity.avgSpeed * activity.duration)
    denominator.set(
      key,
      (denominator.get(key) ?? 0) + activity.avgHeartRate * activity.duration,
    )
  }

  // 从 now 所在月起回退 months-1 个月生成连续序列
  const result: MonthlyAerobicEfficiency[] = []
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1)
  for (let i = 0; i < months; i++) {
    const key = monthKey(cursor)
    const num = numerator.get(key)
    const den = denominator.get(key)
    result.push({
      month: key,
      value: num !== undefined && den !== undefined && den > 0 ? num / den : undefined,
    })
    cursor.setMonth(cursor.getMonth() - 1)
  }
  return result.reverse()
}
