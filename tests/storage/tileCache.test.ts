/**
 * 瓦片缓存模块测试（离线地图）。
 *
 * - 缓存 key 归一化（OSM/高德子域差异，同一瓦片只缓存一份）
 * - getCachedTile 命中返回 Blob 并刷新 lastAccess，未命中返回 undefined
 * - putCachedTile 写入后在超过条数/字节上限时按 LRU 淘汰最旧项
 * - clearTileCache 清空 / getTileCacheStats 统计
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import {
  clearTileCache,
  evictIfNeeded,
  getCachedTile,
  getTileCacheLimits,
  getTileCacheStats,
  isQuotaExceededError,
  isTileCacheWritable,
  negotiateTileCacheLimits,
  putCachedTile,
  resumeTileCacheWrites,
  TILE_CACHE_ACCESS_REFRESH_MS,
  TILE_CACHE_MAX_BYTES,
  TILE_CACHE_MIN_BYTES,
  tileCacheKey,
} from '@/storage/tileCache'

describe('tileCacheKey 归一化', () => {
  it('OSM 子域 a/b/c 归一化为同一 key', () => {
    expect(tileCacheKey('https://a.tile.openstreetmap.org/10/123/456.png')).toBe(
      'https://tile.openstreetmap.org/10/123/456.png',
    )
    expect(tileCacheKey('https://b.tile.openstreetmap.org/10/123/456.png')).toBe(
      'https://tile.openstreetmap.org/10/123/456.png',
    )
    expect(tileCacheKey('https://c.tile.openstreetmap.org/10/123/456.png')).toBe(
      'https://tile.openstreetmap.org/10/123/456.png',
    )
  })

  it('高德子域 webrd01-04 归一化为同一 key', () => {
    expect(tileCacheKey('https://webrd01.is.autonavi.com/appmaptile?x=1&y=2&z=3')).toBe(
      'https://webrd0.is.autonavi.com/appmaptile?x=1&y=2&z=3',
    )
    expect(tileCacheKey('https://webrd04.is.autonavi.com/appmaptile?x=1&y=2&z=3')).toBe(
      'https://webrd0.is.autonavi.com/appmaptile?x=1&y=2&z=3',
    )
  })

  it('无子域 URL（或其他源）原样返回', () => {
    expect(tileCacheKey('https://example.com/tile/1/2/3.png')).toBe('https://example.com/tile/1/2/3.png')
  })
})

describe('瓦片缓存读写', () => {
  let db: CyclingDatabase

  beforeEach(() => {
    db = new CyclingDatabase()
  })

  afterEach(async () => {
    await db.delete()
  })

  it('getCachedTile 未命中返回 undefined', async () => {
    expect(await getCachedTile(db, 'https://tile.openstreetmap.org/10/1/1.png')).toBeUndefined()
  })

  it('putCachedTile 后可读回相同 Blob，重复写入覆盖', async () => {
    const url = 'https://tile.openstreetmap.org/10/1/1.png'
    await putCachedTile(db, url, new Blob(['aaa']))
    await putCachedTile(db, url, new Blob(['bbbbb']))

    const blob = await getCachedTile(db, url)
    expect(blob).toBeDefined()
    // fake-indexeddb 读回的 Blob 是结构化克隆后的普通对象（无 size 方法），
    // 用存储的 size 字段断言覆盖生效（bbb→5）
    const entry = await db.tile_cache.get(url)
    expect(entry?.size).toBe(5)
    expect(await db.tile_cache.count()).toBe(1)
  })

  it('子域不同的同一瓦片共享缓存（读回次数为 1）', async () => {
    await putCachedTile(db, 'https://a.tile.openstreetmap.org/5/10/20.png', new Blob(['tile']))
    const blob = await getCachedTile(db, 'https://b.tile.openstreetmap.org/5/10/20.png')
    expect(blob).toBeDefined()
    expect(await db.tile_cache.count()).toBe(1)
  })

  it('lastAccess 超过刷新间隔的命中会刷新 lastAccess', async () => {
    const url = 'https://tile.openstreetmap.org/10/1/1.png'
    const base = Date.now()
    await db.tile_cache.put({
      url,
      blob: new Blob(['tile']),
      size: 4,
      lastAccess: base - 2 * TILE_CACHE_ACCESS_REFRESH_MS,
    })

    await getCachedTile(db, url)
    const entry = await db.tile_cache.get(url)
    expect(entry).toBeDefined()
    expect((entry?.lastAccess ?? 0)).toBeGreaterThan(base - 1)
  })

  it('刷新间隔内的重复命中不重写 lastAccess（省一个写事务）', async () => {
    const url = 'https://tile.openstreetmap.org/10/1/1.png'
    const recent = Date.now() - 1000
    await db.tile_cache.put({ url, blob: new Blob(['tile']), size: 4, lastAccess: recent })

    await getCachedTile(db, url)
    const entry = await db.tile_cache.get(url)
    expect(entry?.lastAccess).toBe(recent)
  })

  it('clearTileCache 清空全部缓存', async () => {
    await putCachedTile(db, 'https://tile.openstreetmap.org/1/1/1.png', new Blob(['tile']))
    await clearTileCache(db)
    expect(await db.tile_cache.count()).toBe(0)
  })

  it('getTileCacheStats 统计条数与总字节', async () => {
    await putCachedTile(db, 'https://tile.openstreetmap.org/1/1/1.png', new Blob(['12345']))
    await putCachedTile(db, 'https://tile.openstreetmap.org/1/1/2.png', new Blob(['123456']))

    const stats = await getTileCacheStats(db)
    expect(stats.count).toBe(2)
    expect(stats.bytes).toBe(11)
  })
})

describe('LRU 淘汰', () => {
  let db: CyclingDatabase

  beforeEach(() => {
    db = new CyclingDatabase()
  })

  afterEach(async () => {
    await db.delete()
  })

  /** 写入指定 lastAccess 的原始条目（不经淘汰检查） */
  async function seed(urlSuffix: string, lastAccess: number, size: number): Promise<void> {
    await db.tile_cache.put({
      url: `https://tile.openstreetmap.org/1/1/${urlSuffix}.png`,
      blob: new Blob([new Array(size + 1).join('x')]),
      size,
      lastAccess,
    })
  }

  it('超条数上限时淘汰最久未访问的条目', async () => {
    await seed('1', 100, 10)
    await seed('2', 200, 10)
    await seed('3', 300, 10)

    await evictIfNeeded(db, { maxEntries: 2, maxBytes: Number.MAX_SAFE_INTEGER })

    const urls = (await db.tile_cache.toArray()).map((e) => e.url)
    // 只留 lastAccess 最新两条，最旧（1）被淘汰
    expect(urls).not.toContain('https://tile.openstreetmap.org/1/1/1.png')
    expect(urls).toContain('https://tile.openstreetmap.org/1/1/2.png')
    expect(urls).toContain('https://tile.openstreetmap.org/1/1/3.png')
  })

  it('超字节上限时按 lastAccess 从旧到新淘汰直到总量回落到上限内', async () => {
    await seed('1', 100, 60)
    await seed('2', 200, 60)
    await seed('3', 300, 60)

    // 字节上限 100：淘汰到 ≤100，应删掉最旧的 1（60），保留 2+3（120）仍超……
    // 需要精确场景：上限 100 → 需删至 ≤100，先删最旧 1(60) 剩 120 仍超，再删 2(60) 剩 60 ≤ 100。
    await evictIfNeeded(db, { maxEntries: Number.MAX_SAFE_INTEGER, maxBytes: 100 })

    const remaining = await db.tile_cache.toArray()
    const urls = remaining.map((e) => e.url)
    expect(urls).toEqual(['https://tile.openstreetmap.org/1/1/3.png'])
    expect(remaining[0]).toBeDefined()
    expect(remaining[0].size).toBe(60)
  })

  it('未超限时不删除任何条目', async () => {
    await seed('1', 100, 10)
    await seed('2', 200, 10)

    await evictIfNeeded(db, { maxEntries: 3, maxBytes: 100 })

    expect(await db.tile_cache.count()).toBe(2)
  })
})

describe('配额协商与写入熔断（P0 止血）', () => {
  let db: CyclingDatabase

  /** 造一个配额溢出错误（Chrome/Firefox 给 name，Safari 老版本只给 code） */
  function quotaError(): Error {
    const error = new Error('Quota exceeded')
    error.name = 'QuotaExceededError'
    return error
  }

  beforeEach(() => {
    db = new CyclingDatabase()
    resumeTileCacheWrites()
  })

  afterEach(async () => {
    // 熔断标志与协商结果都是模块级状态，必须复位避免污染其它用例
    resumeTileCacheWrites()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await db.delete()
  })

  it('配额较小时按占比下调上限（50MB 配额 → 10MB）', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 50 * 1024 * 1024 }) } })
    const limits = await negotiateTileCacheLimits()
    expect(limits.maxBytes).toBe(10 * 1024 * 1024)
    expect(getTileCacheLimits().maxBytes).toBe(10 * 1024 * 1024)
  })

  it('配额极小时不低于下限（保留基本离线能力）', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 1024 }) } })
    const limits = await negotiateTileCacheLimits()
    expect(limits.maxBytes).toBe(TILE_CACHE_MIN_BYTES)
  })

  it('配额 API 不可用（隐私模式 / 老浏览器）时保持硬上限', async () => {
    vi.stubGlobal('navigator', {})
    const limits = await negotiateTileCacheLimits()
    expect(limits.maxBytes).toBe(TILE_CACHE_MAX_BYTES)
  })

  it('写库抛配额错误后熔断本会话写入，后续瓦片不再尝试写库', async () => {
    const putSpy = vi.spyOn(db.tile_cache, 'put').mockRejectedValue(quotaError())
    await putCachedTile(db, 'https://tile.openstreetmap.org/1/1/1.png', new Blob(['a']))
    expect(isTileCacheWritable()).toBe(false)

    putSpy.mockClear()
    await putCachedTile(db, 'https://tile.openstreetmap.org/1/1/2.png', new Blob(['b']))
    // 熔断后连 put 都不再调用（旧实现会每张瓦片重复一次失败的写事务）
    expect(putSpy).not.toHaveBeenCalled()
  })

  it('非配额的写失败只跳过本次，不熔断整个会话', async () => {
    const putSpy = vi
      .spyOn(db.tile_cache, 'put')
      .mockRejectedValueOnce(new Error('database closed'))

    await putCachedTile(db, 'https://tile.openstreetmap.org/1/1/3.png', new Blob(['c']))
    expect(isTileCacheWritable()).toBe(true)

    putSpy.mockRestore()
    await putCachedTile(db, 'https://tile.openstreetmap.org/1/1/4.png', new Blob(['d']))
    expect(await db.tile_cache.count()).toBe(1)
  })

  it('清空缓存后恢复写入（配额已释放）', async () => {
    vi.spyOn(db.tile_cache, 'put').mockRejectedValue(quotaError())
    await putCachedTile(db, 'https://tile.openstreetmap.org/1/1/5.png', new Blob(['e']))
    expect(isTileCacheWritable()).toBe(false)

    await clearTileCache(db)
    expect(isTileCacheWritable()).toBe(true)
  })

  it('配额错误识别兼容 name 与 code 两种写法', () => {
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true)
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
    expect(isQuotaExceededError({ code: 22 })).toBe(true)
    expect(isQuotaExceededError(new Error('boom'))).toBe(false)
    expect(isQuotaExceededError(null)).toBe(false)
  })
})