/**
 * 数据源分发（规格见 docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md §5.3）。
 *
 * getActivityRepository() 按**调用时**的当前有效数据源返回实现：
 * - author → AuthorActivityRepository（只读快照，fetch + 内存索引）
 * - local  → DexieActivityRepository（本地 IndexedDB，现有实现）
 *
 * 组件请使用 @/hooks/useActivityRepository（源切换时返回不同实例，
 * 作为 effect 依赖驱动重新加载）；本文件函数供非组件场景与测试。
 * 写操作（导入/删除/改名等）永远直连 Dexie 本地仓库，不经此分发。
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
 * 取指定有效源的仓库实现。
 *
 * @param source 有效数据源（默认读 store 当前值）
 */
export function getActivityRepository(
  source: 'author' | 'local' = selectEffectiveSource(useDataSourceStore.getState()),
): ActivityReadRepository {
  return source === 'author' ? authorRepository : localRepository
}
