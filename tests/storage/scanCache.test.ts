/**
 * 全量扫描持久化缓存测试：存取、指纹失配自动失效、空值语义。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/storage/db'
import {
  SCAN_CACHE_HEATMAP,
  loadScanCache,
  saveScanCache,
  summariesScanKey,
} from '@/storage/scanCache'

describe('scanCache 持久化缓存', () => {
  beforeEach(async () => {
    await db.scan_cache.clear()
  })

  afterEach(async () => {
    await db.scan_cache.clear()
  })

  it('保存后按指纹读取成功', async () => {
    await saveScanCache(SCAN_CACHE_HEATMAP, 'fp-1', [[39.9, 116.4], [40.0, 116.5]])

    await expect(loadScanCache<number[][]>(SCAN_CACHE_HEATMAP, 'fp-1')).resolves.toEqual([
      [39.9, 116.4],
      [40.0, 116.5],
    ])
  })

  it('指纹失配返回 null 并清除旧记录', async () => {
    await saveScanCache(SCAN_CACHE_HEATMAP, 'fp-old', ['旧产物'])

    await expect(loadScanCache(SCAN_CACHE_HEATMAP, 'fp-new')).resolves.toBeNull()
    // 旧记录已被清除
    expect(await db.scan_cache.get(SCAN_CACHE_HEATMAP)).toBeUndefined()
  })

  it('无记录返回 null；同名覆盖写', async () => {
    await expect(loadScanCache(SCAN_CACHE_HEATMAP, 'any')).resolves.toBeNull()

    await saveScanCache(SCAN_CACHE_HEATMAP, 'fp-1', { v: 1 })
    await saveScanCache(SCAN_CACHE_HEATMAP, 'fp-2', { v: 2 })

    await expect(loadScanCache(SCAN_CACHE_HEATMAP, 'fp-2')).resolves.toEqual({ v: 2 })
  })
})

describe('summariesScanKey 指纹', () => {
  it('名称变化导致指纹变化（重命名后路线图缓存需刷新）', () => {
    const base = [
      {
        id: 'a',
        name: '晨骑',
        fileId: 'file-a',
        fileName: 'a.fit',
        fingerprint: 'fp-a',
        activityType: 'cycling',
        startTime: '2026-08-01T08:00:00.000Z',
        endTime: '2026-08-01T09:00:00.000Z',
        duration: 3600,
        elapsedTime: 3600,
        distance: 30000,
        elevationGain: 100,
      },
    ]

    const renamed = [{ ...base[0], name: '夜骑' }]

    expect(summariesScanKey(base)).not.toBe(summariesScanKey(renamed))
  })
})
