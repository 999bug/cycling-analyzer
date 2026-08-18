/**
 * 按数据源取训练配置（规格 §5.6）。
 *
 * 作者模式用快照 profile（访客不配置也能看完整训练分析：区间分布、IF/TSS、训练状态）；
 * 本地模式用访客自己的设置。单位/主题偏好不走这里（永远本地）。
 * 快照缺失或拉取失败时回退空配置（训练分析区块按「无配置」显示引导，不伪造）。
 */
import { getSettings, type UserProfile } from '@/features/settings/settings'
import { defaultSnapshotClient, type SnapshotClient } from '@/storage/authorData/snapshotClient'
import type { DataSource } from '@/stores/dataSourceStore'

/**
 * 取当前数据源的训练配置。
 *
 * @param source 有效数据源
 * @param client 快照客户端（测试注入假实现）
 * @returns 训练配置（作者源拉取失败时为空对象）
 */
export async function getEffectiveProfile(
  source: DataSource,
  client: SnapshotClient = defaultSnapshotClient,
): Promise<UserProfile> {
  if (source === 'author') {
    return client.getProfile().catch(() => ({}))
  }
  return (await getSettings()).profile
}
