/**
 * 当前数据源的活动仓库 hook。
 *
 * 返回值为模块级单例（作者/本地各一），源切换时引用变化——
 * 页面把它列入加载 effect 的依赖数组即可实现切源自动刷新，
 * 且 effect 体内真实消费该值（符合 react-hooks 依赖语义）。
 */
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { getActivityRepository } from '@/storage/sourceActivityRepository'
import type { ActivityReadRepository } from '@/storage/repositories/activityRepository'

/**
 * 读取当前有效数据源的活动仓库。
 */
export function useActivityRepository(): ActivityReadRepository {
  const source = useDataSourceStore(selectEffectiveSource)
  return getActivityRepository(source)
}
