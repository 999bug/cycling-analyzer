/**
 * 历史活动 NP 回填（规格 §39 P2）。
 *
 * normalizedPower 字段自功率曲线版本起在导入时落库；此前导入的活动
 * 该字段缺失。训练状态等全量聚合直接读摘要中的 NP（避免每次全量扫描
 * 逐点数据），因此首次使用训练状态前对存量活动做一次按需回填。
 * 回填幂等：仅处理「有平均功率但 NP 缺失」的活动，可反复调用。
 */
import type { ActivityRepository } from '@/storage/repositories/activityRepository'
import { calculateNormalizedPower } from '@/features/analysis/normalizedPower'
import { NP_WINDOW_SECONDS } from '@/features/analysis/normalizedPower'

/**
 * 回填历史活动的标准化功率。
 *
 * @param repository 活动仓库
 * @returns 实际回填的活动数量
 */
export async function backfillNormalizedPower(repository: ActivityRepository): Promise<number> {
  const summaries = await repository.listAllSummaries()
  // 待回填：有平均功率（说明逐点含功率）但 NP 缺失；时长不足 NP 窗口的活动必然算不出，跳过
  const pending = summaries.filter(
    (activity) =>
      activity.normalizedPower === undefined &&
      activity.avgPower !== undefined &&
      activity.duration > NP_WINDOW_SECONDS,
  )

  let updated = 0
  for (const activity of pending) {
    const records = await repository.getRecords(activity.id)
    const normalizedPower = calculateNormalizedPower(records)
    if (normalizedPower !== undefined) {
      await repository.updateNormalizedPower(activity.id, normalizedPower)
      updated++
    }
  }
  return updated
}
