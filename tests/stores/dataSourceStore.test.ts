/**
 * 数据源 store 测试：默认作者优先、有效源回退、探测初始化、持久化。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initDataSource,
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
