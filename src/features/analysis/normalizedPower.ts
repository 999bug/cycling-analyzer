/**
 * 标准化功率（NP）计算（规格 §26）。
 *
 * 标准算法（TrainingPeaks / Garmin）：
 * 1. 过滤缺失功率的记录
 * 2. 对每个采样点计算其过去 30 秒窗口内功率的滑动平均
 * 3. 对滑动平均序列的 4 次方求平均，再开 4 次方
 *
 * 样本不足 30 秒（首尾时间跨度小于窗口）或全部记录均缺失功率时返回 undefined，
 * 不产生无依据的估算值（规格 §26）。
 */
import type { ActivityRecord } from '@/types/activity'

/** 滑动平均窗口（秒）：标准 NP 算法固定窗口 */
export const NP_WINDOW_SECONDS = 30

/**
 * 计算标准化功率（NP）。
 *
 * @param records 逐点记录（按时间顺序存储，函数内防御乱序输入）
 * @returns NP（W）；样本不足 30 秒或全缺功率时 undefined
 */
export function calculateNormalizedPower(records: readonly ActivityRecord[]): number | undefined {
  const powered = records.filter((record) => record.power !== undefined)
  if (powered.length === 0) {
    return undefined
  }

  // 按时间升序：滑动窗口双指针依赖单调时间戳
  const sorted = [...powered].sort((a, b) => a.timestamp - b.timestamp)
  if (sorted[sorted.length - 1].timestamp - sorted[0].timestamp < NP_WINDOW_SECONDS) {
    return undefined
  }

  // 30 秒滑动平均：双指针维护窗口 [t_i - 30s, t_i]
  const windowAverages: number[] = []
  let windowStart = 0
  let windowSum = 0
  for (let i = 0; i < sorted.length; i++) {
    windowSum += sorted[i].power as number
    while (sorted[i].timestamp - sorted[windowStart].timestamp > NP_WINDOW_SECONDS) {
      windowSum -= sorted[windowStart].power as number
      windowStart++
    }
    windowAverages.push(windowSum / (i - windowStart + 1))
  }

  // 滑动平均的 4 次方求平均，再开 4 次方
  const meanPowerFourth =
    windowAverages.reduce((sum, value) => sum + value ** 4, 0) / windowAverages.length
  return meanPowerFourth ** 0.25
}
