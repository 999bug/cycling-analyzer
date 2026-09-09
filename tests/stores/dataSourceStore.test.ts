/**
 * 数据源 store 测试：默认作者优先、有效源回退、探测初始化、持久化、
 * 作者数据可见性策略（auto/show/hide）与临时查看。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initDataSource,
  selectAuthorVisible,
  selectEffectiveSource,
  useDataSourceStore,
} from '@/stores/dataSourceStore'
import type { SnapshotClient } from '@/storage/authorData/snapshotClient'
import { SNAPSHOT_VERSION } from '@/storage/authorData/snapshotTypes'

/** 构造指定 manifest 行为的假快照客户端 */
function makeClient(manifest: { snapshotVersion: number; author: string } | Error): SnapshotClient {
  return {
    getManifest: async () => {
      if (manifest instanceof Error) {
        throw manifest
      }
      return { ...manifest, generatedAt: '', activityCount: 0 }
    },
    getActivities: async () => [],
    getRecords: async () => [],
    getProfile: async () => ({}),
    getSegments: async () => [],
    getTracks: async () => ({ toleranceMeters: 10, tracks: [] }),
    getSegmentResults: async () => ({}),
    getRouteGroups: async () => [],
    getPowerRecords: async () => [],
    getRouteTracks: async () => ({ toleranceMeters: 10, routes: [] }),
  }
}

describe('dataSourceStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
  })

  it('默认选择作者源，但探测成功前有效源回退本地', () => {
    const state = useDataSourceStore.getState()
    expect(state.source).toBe('author')
    expect(selectEffectiveSource(state)).toBe('local')
  })

  it('作者快照可用后有效源为 author', () => {
    useDataSourceStore.getState().setAuthorAvailable(true, 'Saul')
    expect(selectEffectiveSource(useDataSourceStore.getState())).toBe('author')
  })

  it('用户选择本地后即使快照可用也保持本地', () => {
    useDataSourceStore.getState().setAuthorAvailable(true, 'Saul')
    useDataSourceStore.getState().setSource('local')
    expect(selectEffectiveSource(useDataSourceStore.getState())).toBe('local')
  })

  it('initDataSource 成功：标记可用并记录作者名', async () => {
    await initDataSource(makeClient({ snapshotVersion: SNAPSHOT_VERSION, author: 'Saul' }))
    const state = useDataSourceStore.getState()
    expect(state.authorAvailable).toBe(true)
    expect(state.authorName).toBe('Saul')
  })

  it('initDataSource 版本不兼容：回退本地', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await initDataSource(makeClient({ snapshotVersion: 999, author: 'Saul' }))
    expect(useDataSourceStore.getState().authorAvailable).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('initDataSource 拉取失败：回退本地不打断', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await initDataSource(makeClient(new Error('HTTP 404')))
    expect(useDataSourceStore.getState().authorAvailable).toBe(false)
    warn.mockRestore()
  })

  it('仅持久化 source 选择（探测结果不持久化）', () => {
    useDataSourceStore.getState().setSource('local')
    const persisted = JSON.parse(localStorage.getItem('cycling-data-source') ?? '{}') as {
      state?: Record<string, unknown>
    }
    expect(persisted.state?.source).toBe('local')
    expect(persisted.state?.authorAvailable).toBeUndefined()
    expect(persisted.state?.authorName).toBeUndefined()
  })
})

describe('作者数据可见性（authorVisibility）', () => {
  beforeEach(() => {
    localStorage.clear()
    useDataSourceStore.setState({
      source: 'author',
      authorAvailable: true,
      authorName: null,
      authorVisibility: 'auto',
      hasLocalData: false,
      authorHiddenNoticePending: false,
      peekAuthorData: false,
    })
  })

  it('auto：本地无数据时作者数据可见，有效源为 author', () => {
    const state = useDataSourceStore.getState()
    expect(selectAuthorVisible(state)).toBe(true)
    expect(selectEffectiveSource(state)).toBe('author')
  })

  it('auto：本地有数据时作者数据隐藏，有效源回退 local', () => {
    useDataSourceStore.setState({ hasLocalData: true })
    const state = useDataSourceStore.getState()
    expect(selectAuthorVisible(state)).toBe(false)
    expect(selectEffectiveSource(state)).toBe('local')
  })

  it('show：本地有数据也保持可见', () => {
    useDataSourceStore.setState({ hasLocalData: true, authorVisibility: 'show' })
    const state = useDataSourceStore.getState()
    expect(selectAuthorVisible(state)).toBe(true)
    expect(selectEffectiveSource(state)).toBe('author')
  })

  it('hide：本地无数据也强制隐藏', () => {
    useDataSourceStore.setState({ authorVisibility: 'hide' })
    const state = useDataSourceStore.getState()
    expect(selectAuthorVisible(state)).toBe(false)
    expect(selectEffectiveSource(state)).toBe('local')
  })

  it('setHasLocalData 从无到有且 auto：置一次性提示标记', () => {
    useDataSourceStore.getState().setHasLocalData(true)
    expect(useDataSourceStore.getState().authorHiddenNoticePending).toBe(true)
  })

  it('本地已有数据时再次导入：不重复置提示标记', () => {
    useDataSourceStore.getState().setHasLocalData(true)
    useDataSourceStore.getState().dismissAuthorHiddenNotice()
    useDataSourceStore.getState().setHasLocalData(true)
    expect(useDataSourceStore.getState().authorHiddenNoticePending).toBe(false)
  })

  it('show/hide 策略下发现本地数据：不置提示标记', () => {
    useDataSourceStore.setState({ authorVisibility: 'show' })
    useDataSourceStore.getState().setHasLocalData(true)
    expect(useDataSourceStore.getState().authorHiddenNoticePending).toBe(false)
  })

  it('dismiss 清除提示标记', () => {
    useDataSourceStore.getState().setHasLocalData(true)
    useDataSourceStore.getState().dismissAuthorHiddenNotice()
    expect(useDataSourceStore.getState().authorHiddenNoticePending).toBe(false)
  })

  it('显式切源清除临时查看状态', () => {
    useDataSourceStore.setState({ peekAuthorData: true })
    useDataSourceStore.getState().setSource('local')
    expect(useDataSourceStore.getState().peekAuthorData).toBe(false)
  })

  it('临时查看优先于可见性策略：隐藏时有效源仍为 author', () => {
    useDataSourceStore.setState({ hasLocalData: true, peekAuthorData: true })
    expect(selectEffectiveSource(useDataSourceStore.getState())).toBe('author')
  })

  it('临时查看优先于本地源选择', () => {
    useDataSourceStore.setState({ source: 'local', peekAuthorData: true })
    expect(selectEffectiveSource(useDataSourceStore.getState())).toBe('author')
  })

  it('持久化可见性策略与提示标记（不持久化运行时状态）', () => {
    // auto 下导入置提示标记，随后切换为 show
    useDataSourceStore.getState().setHasLocalData(true)
    useDataSourceStore.getState().setAuthorVisibility('show')
    const persisted = JSON.parse(localStorage.getItem('cycling-data-source') ?? '{}') as {
      state?: Record<string, unknown>
    }
    expect(persisted.state?.authorVisibility).toBe('show')
    expect(persisted.state?.authorHiddenNoticePending).toBe(true)
    expect(persisted.state?.hasLocalData).toBeUndefined()
    expect(persisted.state?.peekAuthorData).toBeUndefined()
  })
})

describe('initDataSource 本地活动数探测', () => {
  beforeEach(() => {
    localStorage.clear()
    useDataSourceStore.setState({
      source: 'author',
      authorAvailable: false,
      authorName: null,
      authorVisibility: 'auto',
      hasLocalData: false,
      authorHiddenNoticePending: false,
      peekAuthorData: false,
    })
  })

  it('本地有活动：标记 hasLocalData 并置提示标记', async () => {
    const client = makeClient(new Error('no snapshot'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await initDataSource(client, async () => 5)
    warn.mockRestore()
    const state = useDataSourceStore.getState()
    expect(state.hasLocalData).toBe(true)
    expect(state.authorHiddenNoticePending).toBe(true)
    expect(state.authorAvailable).toBe(false)
  })

  it('本地无活动：不置提示标记', async () => {
    const client = makeClient(new Error('no snapshot'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await initDataSource(client, async () => 0)
    warn.mockRestore()
    const state = useDataSourceStore.getState()
    expect(state.hasLocalData).toBe(false)
    expect(state.authorHiddenNoticePending).toBe(false)
  })

  it('活动数探测失败：视为本地无数据，快照探测不受影响', async () => {
    const client = makeClient({ snapshotVersion: SNAPSHOT_VERSION, author: 'Saul' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await initDataSource(client, async () => {
      throw new Error('IndexedDB unavailable')
    })
    expect(useDataSourceStore.getState().hasLocalData).toBe(false)
    expect(useDataSourceStore.getState().authorAvailable).toBe(true)
    warn.mockRestore()
  })
})
