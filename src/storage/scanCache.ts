/**
 * 全量逐点扫描缓存键（性能优化，任务 #18）。
 *
 * 统计页/热力图/赛段页需扫描全部活动的逐点数据，离开再回来重扫导致卡顿。
 * 逐点记录导入后不可变，任何新增/删除活动都会改变活动数、总距离或最新开始时间，
 * 故「数量|总距离|最新开始时间」可作为安全的内容指纹失效缓存。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/**
 * 计算活动集合的内容指纹（扫描缓存键）。
 *
 * @param summaries 全部活动摘要
 * @returns 缓存键字符串（空集合返回固定值 '0|0|'）
 */
export function summariesScanKey(summaries: readonly ActivitySummary[]): string {
  let latestStartTime = ''
  let totalDistance = 0
  for (const summary of summaries) {
    totalDistance += summary.distance
    if (summary.startTime > latestStartTime) {
      latestStartTime = summary.startTime
    }
  }
  return `${summaries.length}|${totalDistance}|${latestStartTime}`
}
