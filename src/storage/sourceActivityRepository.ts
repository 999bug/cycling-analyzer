/**
 * 数据源门面（规格见 docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md §5.3）。
 *
 * 读取调用按**调用时**的当前有效数据源分发：
 * - author → AuthorActivityRepository（只读快照，fetch + 内存索引）
 * - local  → DexieActivityRepository（本地 IndexedDB，现有实现）
 *
 * 只暴露读取接口：导入/删除/改名等写操作永远直连 Dexie 本地仓库，
 * 不经过本门面（作者数据只读，UI 在作者模式下隐藏写入口）。
 */
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivityReadRepository,
} from '@/storage/repositories/activityRepository'
import { AuthorActivityRepository } from '@/storage/authorData/authorActivityRepository'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'

/** 本地库实现单例 */
const localRepository = new DexieActivityRepository(db)

/** 作者快照实现单例 */
const authorRepository = new AuthorActivityRepository(defaultSnapshotClient)

/**
 * 取当前有效源的仓库实现。
 */
function current(): ActivityReadRepository {
  return selectEffectiveSource(useDataSourceStore.getState()) === 'author'
    ? authorRepository
    : localRepository
}

/**
 * 按当前数据源分发的活动仓库（读取）。页面/区块统一经此访问活动数据，
 * 并订阅 useDataSourceStore 的 source/authorAvailable 变化触发重新加载。
 */
export const sourceActivityRepository: ActivityReadRepository = {
  getById: (id) => current().getById(id),
  getRecords: (id, options) => current().getRecords(id, options),
  listActivities: (options) => current().listActivities(options),
  countActivities: () => current().countActivities(),
  existsByFingerprint: (fingerprint) => current().existsByFingerprint(fingerprint),
  summarizeByRange: (startTime, endTime) => current().summarizeByRange(startTime, endTime),
  listAllSummaries: () => current().listAllSummaries(),
}
