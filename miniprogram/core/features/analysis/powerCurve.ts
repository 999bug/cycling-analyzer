/**
 * 功率曲线计算（规格 §39 P2）。
 *
 * 功率曲线 = 每个目标时长上的最佳平均功率（Best Average Power）。
 * 口径：
 * - 仅使用含功率的记录，按时间升序防御乱序
 * - 记录 k 的功率视为区间 [t_{k-1}, t_k] 的代表值，窗口能量 = Σ p·Δt
 * - Δt 钳制到 MAX_GAP_SECONDS：断档/停车超过该时长的区间不计能量，
 *   避免长时间无数据被当作 0W 拉低或被单点功率虚高
 * - 窗口平均 = 窗口能量 / 窗口实际时长（不等间隔采样下仍成立）
 * - 活动跨度不足某时长时该时长无点（不伪造，规格 §25）
 */
import type { ActivityRecord } from '../../types/activity'

/** 断档钳制时长（秒）：相邻记录间隔超过该值时按该值计能量 */
const MAX_GAP_SECONDS = 5

/** 标准功率曲线时长集（秒）：1s/5s/15s/30s/1/2/5/10/20/30/60 min */
export const POWER_CURVE_DURATIONS: readonly number[] = [
  1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600,
]

/**
 * 功率曲线采样点。
 */
export interface PowerCurvePoint {
  /** 时长（秒） */
  duration: number

  /** 该时长的最佳平均功率（W） */
  power: number
}

/**
 * 计算单次活动的功率曲线。
 *
 * @param records 逐点记录（函数内防御乱序与缺失功率）
 * @param durations 目标时长集（秒，默认标准 11 档）
 * @returns 各时长最佳平均功率（按时长升序），无功率数据时为空数组
 */
export function buildPowerCurve(
  records: readonly ActivityRecord[],
  durations: readonly number[] = POWER_CURVE_DURATIONS,
): PowerCurvePoint[] {
  const powered = records
    .filter((record) => record.power !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp)
  if (powered.length === 0) {
    return []
  }

  // 前缀能量：segment[k] = p_k × min(t_k - t_{k-1}, MAX_GAP)，窗口 [i, j] 能量 = prefix[j] - prefix[i]
  const prefixEnergy = new Array<number>(powered.length).fill(0)
  for (let k = 1; k < powered.length; k++) {
    const gap = Math.min(powered[k].timestamp - powered[k - 1].timestamp, MAX_GAP_SECONDS)
    prefixEnergy[k] = prefixEnergy[k - 1] + (powered[k].power as number) * Math.max(gap, 0)
  }

  const points: PowerCurvePoint[] = []
  for (const duration of [...durations].sort((a, b) => a - b)) {
    const best = bestAveragePower(powered, prefixEnergy, duration)
    if (best !== undefined) {
      points.push({ duration, power: best })
    }
  }
  return points
}

/**
 * 双指针求指定时长的最佳平均功率：j 随 i 单调前移，摊还 O(n)。
 *
 * @param powered 含功率记录（已按时间升序）
 * @param prefixEnergy 前缀能量数组
 * @param duration 目标时长（秒）
 * @returns 最佳平均功率（W）；活动跨度不足该时长时 undefined
 */
function bestAveragePower(
  powered: readonly ActivityRecord[],
  prefixEnergy: readonly number[],
  duration: number,
): number | undefined {
  let best: number | undefined
  let j = 0
  for (let i = 0; i < powered.length; i++) {
    if (j < i) {
      j = i
    }
    while (j + 1 < powered.length && powered[j].timestamp - powered[i].timestamp < duration) {
      j++
    }
    const span = powered[j].timestamp - powered[i].timestamp
    if (span < duration) {
      // 窗口已到末尾仍不足目标时长，更大的 i 也不可能满足
      break
    }
    const average = (prefixEnergy[j] - prefixEnergy[i]) / span
    if (best === undefined || average > best) {
      best = average
    }
  }
  return best
}
