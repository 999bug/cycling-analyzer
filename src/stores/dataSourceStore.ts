/**
 * 数据源 store（zustand + persist）。
 *
 * 两个数据源：'author'（作者发布的只读快照）与 'local'（访客本地 IndexedDB）。
 * 用户选择持久化到 localStorage；快照可用性（authorAvailable）为运行时探测结果，
 * 不持久化——每次启动由 initDataSource 重新探测 manifest.json，
 * 探测成功前有效源回退 local（本地 dev 未生成快照时访客流程不受影响）。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SNAPSHOT_VERSION } from '@/storage/authorData/snapshotTypes'
import { defaultSnapshotClient, type SnapshotClient } from '@/storage/authorData/snapshotClient'

/** 数据源标识 */
export type DataSource = 'author' | 'local'

/** 数据源 store 状态与 actions */
export interface DataSourceState {
  /** 用户显式选择的数据源（默认作者） */
  source: DataSource

  /** 快照探测结果（默认 false：探测成功前有效源回退 local） */
  authorAvailable: boolean

  /** 作者显示名（来自 manifest，探测失败为 null） */
  authorName: string | null

  /** 设置数据源选择（持久化） */
  setSource(source: DataSource): void

  /** 设置快照探测结果（运行时状态，不持久化） */
  setAuthorAvailable(available: boolean, authorName?: string): void
}

/** 数据源 store 实例（persist key：cycling-data-source） */
export const useDataSourceStore = create<DataSourceState>()(
  persist(
    (set) => ({
      source: 'author',
      authorAvailable: false,
      authorName: null,
      setSource: (source) => set({ source }),
      setAuthorAvailable: (available, authorName) =>
        set({ authorAvailable: available, authorName: authorName ?? null }),
    }),
    {
      name: 'cycling-data-source',
      partialize: (state) => ({ source: state.source }),
    },
  ),
)

/**
 * 有效数据源：用户选择作者源但快照不可用时回退本地。
 *
 * @param state store 状态（或同名结构）
 */
export function selectEffectiveSource(state: {
  source: DataSource
  authorAvailable: boolean
}): DataSource {
  return state.source === 'author' && state.authorAvailable ? 'author' : 'local'
}

/**
 * 启动时探测作者快照：拉取 manifest 并校验版本。
 * 失败（未生成/网络/版本不兼容）静默回退本地源，不打断访客。
 *
 * @param client 快照客户端（测试注入假实现）
 */
export async function initDataSource(client: SnapshotClient = defaultSnapshotClient): Promise<void> {
  try {
    const manifest = await client.getManifest()
    if (manifest.snapshotVersion !== SNAPSHOT_VERSION) {
      throw new Error(`Unsupported snapshot version: ${manifest.snapshotVersion}`)
    }
    useDataSourceStore.getState().setAuthorAvailable(true, manifest.author)
  } catch (error) {
    console.warn('Author snapshot unavailable, falling back to local data', error)
    useDataSourceStore.getState().setAuthorAvailable(false)
  }
}
