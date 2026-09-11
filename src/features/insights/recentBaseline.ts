/**
 * 历史对比基线（纯函数）。
 *
 * 从骑行活动摘要列表聚合「近期骑行均值」，供骑行洞察做本次 vs 近期的对比。
 * 调用方（详情页）传入 `listCyclingSummaries(repository)` 的结果（已按骑行口径过滤），
 * 本模块只负责：排除当前活动 → 按开始时间取最近 N 次 → 求均值。
 *
 * 均值口径：算术平均（非时长加权）——近 N 次「单次表现」的平均水平，
 * 与「总均速」语义一致，且不被单次超长骑行拉偏口径解释。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/** 近期对比基线（洞察层消费） */
export interface RecentBaseline {
  /** 参与均值的样本活动数 */
  sampleCount: number

  /** 近期平均速度（m/s，算术平均） */
  avgSpeed?: number

  /** 近期平均功率（W，算术平均；样本不足时缺省） */
  avgPower?: number
}

/** 取最近多少次骑行作为基线窗口 */
export const RECENT_BASELINE_WINDOW = 30

/** 基线最少样本数（低于该值不做对比，避免「2 次平均」误导） */
export const RECENT_BASELINE_MIN_SAMPLES = 5

/** 功率均值最少样本数（带功率码表的用户才参与功率对比） */
export const RECENT_BASELINE_MIN_POWER_SAMPLES = 3

/**
 * 构建近期骑行基线。
 *
 * @param summaries 骑行口径活动摘要（`listCyclingSummaries` 输出）
 * @param excludeId 当前活动 ID（对比自己没有意义）
 * @returns 基线；样本不足或均速数据缺失时 undefined
 */
export function buildRecentBaseline(
  summaries: readonly ActivitySummary[],
  excludeId?: string,
): RecentBaseline | undefined {
  const candidates = summaries
    .filter(
      (summary) =>
        summary.id !== excludeId &&
        typeof summary.avgSpeed === 'number' &&
        summary.avgSpeed > 0,
    )
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
    .slice(0, RECENT_BASELINE_WINDOW)

  if (candidates.length < RECENT_BASELINE_MIN_SAMPLES) {
    return undefined
  }

  const avgSpeed = meanOf(candidates.map((summary) => summary.avgSpeed as number))

  // 功率均值：仅当窗口内足够多活动带功率时提供（否则对比口径不稳）
  const powerSamples = candidates.filter(
    (summary) => typeof summary.avgPower === 'number' && summary.avgPower > 0,
  )
  const avgPower =
    powerSamples.length >= RECENT_BASELINE_MIN_POWER_SAMPLES
      ? meanOf(powerSamples.map((summary) => summary.avgPower as number))
      : undefined

  return { sampleCount: candidates.length, avgSpeed, avgPower }
}

/**
 * 算术平均。
 *
 * @param values 数值列表（非空）
 * @returns 均值
 */
function meanOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
