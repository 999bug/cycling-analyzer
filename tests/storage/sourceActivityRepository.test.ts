/**
 * 数据源门面测试：按 store 当前有效源分发读取调用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { sourceActivityRepository } from '@/storage/sourceActivityRepository'
import { useDataSourceStore } from '@/stores/dataSourceStore'

/** 作者快照中的一条摘要（经由 fetch mock 提供） */
const AUTHOR_SUMMARY = {
  id: 'author-1',
  fileId: 'author-1',
  fileName: 'author.fit.gz',
  fingerprint: 'fp-author-1',
  activityType: 'cycling',
  startTime: '2026-08-01T00:00:00.000Z',
  endTime: '2026-08-01T02:00:00.000Z',
  duration: 7200,
  elapsedTime: 7300,
  distance: 60000,
  elevationGain: 500,
}

describe('sourceActivityRepository 门面', () => {
  let db: CyclingDatabase

  beforeEach(async () => {
    useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
    // 准备本地库一条记录（local 源数据）
    db = new CyclingDatabase()
    await new DexieActivityRepository(db).addActivity({
      id: 'local-1',
      fileId: 'local-1',
      fileName: 'local.fit',
      fingerprint: 'fp-local-1',
      activityType: 'cycling',
      startTime: '2026-08-02T00:00:00.000Z',
      endTime: '2026-08-02T01:00:00.000Z',
      duration: 3600,
      elapsedTime: 3600,
      distance: 30000,
      elevationGain: 200,
    })
    // 注意：门面内 Dexie 实现使用全局 db 单例，fake-indexeddb 环境下
    // 全局 db 与本测试库同库名同数据（fake-indexeddb 按名共享后端）
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await db.delete()
    await new CyclingDatabase().delete()
  })

  it('有效源为 local 时读取本地库', async () => {
    const summaries = await sourceActivityRepository.listAllSummaries()
    expect(summaries.map((a) => a.id)).toEqual(['local-1'])
  })

  it('有效源为 author 时读取快照', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('author-data/activities.json')) {
          return new Response(JSON.stringify([AUTHOR_SUMMARY]), { status: 200 })
        }
        return new Response('not found', { status: 404 })
      }),
    )
    useDataSourceStore.setState({ source: 'author', authorAvailable: true, authorName: 'Saul' })

    const summaries = await sourceActivityRepository.listAllSummaries()
    expect(summaries.map((a) => a.id)).toEqual(['author-1'])
  })

  it('用户选择 author 但快照不可用时回退本地', async () => {
    useDataSourceStore.setState({ source: 'author', authorAvailable: false })
    const summaries = await sourceActivityRepository.listAllSummaries()
    expect(summaries.map((a) => a.id)).toEqual(['local-1'])
  })
})
