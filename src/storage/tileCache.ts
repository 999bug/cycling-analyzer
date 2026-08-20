/**
 * 瓦片缓存模块（离线地图）。
 *
 * 地图瓦片存 IndexedDB（tile_cache 表），LRU 淘汰（字节/条数双上限）：
 * - getCachedTile：命中并刷新 lastAccess（按最后访问时间淘汰）
 * - putCachedTile：写入后触发淘汰，超限删除最久未访问的瓦片
 * - 缓存 key 归一化（去掉 OSM/高德子域差异），避免同一瓦片多份缓存
 */
import type { CyclingDatabase } from '@/storage/db'

/** 瓦片缓存字节上限（100MB） */
export const TILE_CACHE_MAX_BYTES = 100 * 1024 * 1024

/** 瓦片缓存条数上限（20000 张） */
export const TILE_CACHE_MAX_ENTRIES = 20_000

/** OSM 子域前缀（a/b/c） */
const OSM_SUBDOMAIN = /^https:\/\/[abc]\.tile\.openstreetmap\.org\//

/** 高德子域前缀（webrd01-04） */
const AMAP_SUBDOMAIN = /^https:\/\/webrd0[1-4]\.is\.autonavi\.com\//

/**
 * 瓦片缓存 key：归一化 URL（去子域差异），同一瓦片只缓存一份。
 *
 * @param url 瓦片完整 URL
 * @returns 归一化后的缓存 key
 */
export function tileCacheKey(url: string): string {
  if (OSM_SUBDOMAIN.test(url)) {
    return url.replace(OSM_SUBDOMAIN, 'https://tile.openstreetmap.org/')
  }
  if (AMAP_SUBDOMAIN.test(url)) {
    return url.replace(AMAP_SUBDOMAIN, 'https://webrd0.is.autonavi.com/')
  }
  return url
}

/**
 * 读取瓦片缓存（命中时刷新 lastAccess）。
 *
 * @param db 数据库实例（测试可注入独立实例）
 * @param url 瓦片完整 URL
 * @returns 缓存 Blob，未命中时 undefined
 */
export async function getCachedTile(db: CyclingDatabase, url: string): Promise<Blob | undefined> {
  const key = tileCacheKey(url)
  const entry = await db.tile_cache.get(key)
  if (entry === undefined) {
    return undefined
  }
  await db.tile_cache.update(key, { lastAccess: Date.now() })
  return entry.blob
}

/**
 * 写入瓦片缓存（覆盖同 key 旧值），写入后按 LRU 淘汰超限数据。
 *
 * @param db 数据库实例（测试可注入独立实例）
 * @param url 瓦片完整 URL
 * @param blob 瓦片二进制
 */
export async function putCachedTile(db: CyclingDatabase, url: string, blob: Blob): Promise<void> {
  const key = tileCacheKey(url)
  await db.tile_cache.put({ url: key, blob, size: blob.size, lastAccess: Date.now() })
  await evictIfNeeded(db)
}

/**
 * 清空全部瓦片缓存。
 *
 * @param db 数据库实例（测试可注入独立实例）
 */
export async function clearTileCache(db: CyclingDatabase): Promise<void> {
  await db.tile_cache.clear()
}

/**
 * 瓦片缓存统计。
 */
export interface TileCacheStats {
  /** 缓存条数 */
  count: number
  /** 缓存总字节数 */
  bytes: number
}

/**
 * 读取瓦片缓存统计（条数 + 总字节）。
 *
 * @param db 数据库实例（测试可注入独立实例）
 * @returns 缓存统计
 */
export async function getTileCacheStats(db: CyclingDatabase): Promise<TileCacheStats> {
  let count = 0
  let bytes = 0
  await db.tile_cache.each((entry) => {
    count += 1
    bytes += entry.size
  })
  return { count, bytes }
}

/**
 * LRU 淘汰：超出字节/条数上限时，删除最久未访问的瓦片直到回到上限内。
 *
 * @param db 数据库实例（测试可注入独立实例）
 * @param limits 缓存上限（缺省用全局默认；测试可传小值低成本触发）
 */
export async function evictIfNeeded(
  db: CyclingDatabase,
  limits?: { maxBytes: number; maxEntries: number },
): Promise<void> {
  const maxBytes = limits?.maxBytes ?? TILE_CACHE_MAX_BYTES
  const maxEntries = limits?.maxEntries ?? TILE_CACHE_MAX_ENTRIES
  const stats = await getTileCacheStats(db)
  if (stats.count <= maxEntries && stats.bytes <= maxBytes) {
    return
  }
  // 按 lastAccess 升序（最久未访问在前）逐个删除，直到双上限内
  const oldest = await db.tile_cache.orderBy('lastAccess').toArray()
  let { count, bytes } = stats
  const toDelete: string[] = []
  for (const entry of oldest) {
    if (count <= maxEntries && bytes <= maxBytes) {
      break
    }
    toDelete.push(entry.url)
    count -= 1
    bytes -= entry.size
  }
  if (toDelete.length > 0) {
    await db.tile_cache.bulkDelete(toDelete)
  }
}