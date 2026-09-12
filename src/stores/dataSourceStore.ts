/**
 * 数据源 store（zustand + persist）。
 *
 * 两个数据源：'author'（作者发布的只读快照）与 'local'（访客本地 IndexedDB）。
 * 用户选择持久化到 localStorage；快照可用性（authorAvailable）为运行时探测结果，
 * 不持久化——每次启动由 initDataSource 重新探测 manifest.json，
 * 探测成功前有效源回退 local（本地 dev 未生成快照时访客流程不受影响）。
 *
 * 作者数据可见性（authorVisibility，持久化）：
 * - 'auto'（默认）：本地有骑行数据时隐藏作者数据（作为空状态示例的角色随导入退场），
 *   本地为空时显示；判定为运行时动态——清空本地数据后作者数据自动回来兜底
 * - 'show'：始终显示（设置页可改）
 * - 'hide'：始终隐藏（设置页可改）
 *
 * 一次性提示（authorHiddenNoticePending，持久化）：auto 策略下本地数据从无到有、
 * 作者数据因此被隐藏时置 true，用户在提示条确认后清除，避免每次打开重复打扰。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SNAPSHOT_VERSION } from '@/storage/authorData/snapshotTypes'
import { defaultSnapshotClient, type SnapshotClient } from '@/storage/authorData/snapshotClient'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'

/** 数据源标识 */
export type DataSource = 'author' | 'local'

/** 作者数据可见性策略（设置页「作者数据」区块） */
export type AuthorDataVisibility = 'auto' | 'show' | 'hide'

/** 本地活动数默认探测：全局数据库 activities 表行数 */
const defaultLocalRepository = new DexieActivityRepository(db)

/**
 * 统计本地活动数（initDataSource 默认实现；测试可注入替代）。
 */
async function defaultCountLocalActivities(): Promise<number> {
  return defaultLocalRepository.countActivities()
}

/** 数据源 store 状态与 actions */
export interface DataSourceState {
  /** 用户显式选择的数据源（默认作者） */
  source: DataSource

  /** 快照探测结果（默认 false：探测成功前有效源回退 local） */
  authorAvailable: boolean

  /** 作者显示名（来自 manifest，探测失败为 null） */
  authorName: string | null

  /** 作者数据可见性策略（持久化，默认 auto） */
  authorVisibility: AuthorDataVisibility

  /** 本地是否已有骑行活动（auto 判定输入，运行时探测，不持久化） */
  hasLocalData: boolean

  /** 一次性提示：作者数据因 auto 被隐藏，待用户在提示条确认（持久化） */
  authorHiddenNoticePending: boolean

  /** 顶部「示例数据」说明条是否已被用户关闭（持久化，设置页可恢复显示） */
  authorBannerDismissed: boolean

  /** 临时查看作者数据（深链兜底；运行时状态不持久化，离开详情页自动清除） */
  peekAuthorData: boolean

  /** 设置数据源选择（持久化；显式切源同时清除临时查看状态） */
  setSource(source: DataSource): void

  /** 设置快照探测结果（运行时状态，不持久化） */
  setAuthorAvailable(available: boolean, authorName?: string): void

  /** 设置作者数据可见性策略（设置页，立即生效并持久化） */
  setAuthorVisibility(visibility: AuthorDataVisibility): void

  /** 更新本地数据有无状态；auto 策略下从无到有时置一次性提示标记 */
  setHasLocalData(has: boolean): void

  /** 用户已确认「作者数据已隐藏」提示（清除一次性标记） */
  dismissAuthorHiddenNotice(): void

  /** 关闭顶部「示例数据」说明条（持久化，不再自动显示） */
  dismissAuthorBanner(): void

  /** 恢复顶部「示例数据」说明条（设置页入口） */
  restoreAuthorBanner(): void

  /** 开/关临时查看作者数据（深链「仅本次查看」） */
  setPeekAuthorData(active: boolean): void
}

/** 数据源 store 实例（persist key：cycling-data-source） */
export const useDataSourceStore = create<DataSourceState>()(
  persist(
    (set) => ({
      source: 'author',
      authorAvailable: false,
      authorName: null,
      authorVisibility: 'auto',
      hasLocalData: false,
      authorHiddenNoticePending: false,
      authorBannerDismissed: false,
      peekAuthorData: false,
      // 显式切源视为用户主见，同时清除临时查看状态
      setSource: (source) => set({ source, peekAuthorData: false }),
      setAuthorAvailable: (available, authorName) =>
        set({ authorAvailable: available, authorName: authorName ?? null }),
      setAuthorVisibility: (authorVisibility) => set({ authorVisibility }),
      setHasLocalData: (has) =>
        set((state) => ({
          hasLocalData: has,
          // auto 策略下本地数据从无到有 → 作者数据将被隐藏，置一次性提示；
          // 已有数据时再导入不重复打扰，用户手动 show/hide 时也不提示
          authorHiddenNoticePending:
            has && !state.hasLocalData && state.authorVisibility === 'auto'
              ? true
              : state.authorHiddenNoticePending,
        })),
      dismissAuthorHiddenNotice: () => set({ authorHiddenNoticePending: false }),
      dismissAuthorBanner: () => set({ authorBannerDismissed: true }),
      restoreAuthorBanner: () => set({ authorBannerDismissed: false }),
      setPeekAuthorData: (peekAuthorData) => set({ peekAuthorData }),
    }),
    {
      name: 'cycling-data-source',
      // 老版本持久化对象不含 authorVisibility / authorHiddenNoticePending，
      // zustand persist 浅合并下缺失键保留初始值（auto / false），无需显式迁移
      partialize: (state) => ({
        source: state.source,
        authorVisibility: state.authorVisibility,
        authorHiddenNoticePending: state.authorHiddenNoticePending,
        authorBannerDismissed: state.authorBannerDismissed,
      }),
    },
  ),
)

/**
 * 作者数据当前是否可见（可见性策略 + 本地数据有无的联合判定）。
 *
 * @param state store 状态（或同名结构）
 */
export function selectAuthorVisible(state: {
  authorVisibility: AuthorDataVisibility
  hasLocalData: boolean
}): boolean {
  if (state.authorVisibility === 'show') {
    return true
  }
  if (state.authorVisibility === 'hide') {
    return false
  }
  return !state.hasLocalData
}

/**
 * 有效数据源：作者源需同时满足「用户选择作者 + 快照可用 + 作者数据可见」，
 * 任一不满足即回退本地（作者数据被隐藏时用户选择应无缝落在自己的数据上）。
 *
 * 例外：临时查看（peekAuthorData，深链兜底「仅本次查看」）且快照可用时，
 * 强制有效源为作者——优先级高于可见性策略与用户源选择（切源动作会清 peek）。
 *
 * @param state store 状态（或同名结构）
 */
export function selectEffectiveSource(state: {
  source: DataSource
  authorAvailable: boolean
  authorVisibility: AuthorDataVisibility
  hasLocalData: boolean
  peekAuthorData: boolean
}): DataSource {
  if (state.authorAvailable && state.peekAuthorData) {
    return 'author'
  }
  return state.source === 'author' && state.authorAvailable && selectAuthorVisible(state)
    ? 'author'
    : 'local'
}

/**
 * 启动时初始化数据源状态：
 * 1. 探测本地活动数 → setHasLocalData（auto 判定输入；首次发现本地有数据
 *    且策略为 auto 时自动置一次性提示标记）
 * 2. 探测作者快照：拉取 manifest 并校验版本。
 *    失败（未生成/网络/版本不兼容）静默回退本地源，不打断访客。
 *
 * @param client 快照客户端（测试注入假实现）
 * @param countLocalActivities 本地活动数探测（测试注入替代）
 */
export async function initDataSource(
  client: SnapshotClient = defaultSnapshotClient,
  countLocalActivities: () => Promise<number> = defaultCountLocalActivities,
): Promise<void> {
  try {
    const count = await countLocalActivities()
    useDataSourceStore.getState().setHasLocalData(count > 0)
  } catch (error) {
    console.warn('Failed to count local activities, treating as empty', error)
  }
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
