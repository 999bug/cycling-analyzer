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

/**
 * 淘汰检查写入间隔：每 N 次写入才做一次完整统计。
 *
 * 完整统计需流式遍历整表（含 Blob 反序列化），每张瓦片写完都查一次会把
 * 「浏览新区域」变成几十次全表扫描（上限 2 万条），是瓦片链路最大的性能坑。
 * 节流后最坏情况少量超出上限（N-1 张 × 单瓦片体积），相对 100MB 上限可忽略。
 */
export const TILE_CACHE_EVICT_INTERVAL = 16

/**
 * lastAccess 刷新最小间隔（毫秒）：60 秒内重复命中不写库。
 *
 * 命中路径原本每次都多一个写事务（平移地图时事务排队加剧卡顿）；
 * 淘汰按 lastAccess 排序，分钟级精度对 LRU 顺序几乎无影响。
 */
export const TILE_CACHE_ACCESS_REFRESH_MS = 60_000

/** 淘汰检查写入计数（模块级：同一页面所有写入共享节流） */
let writesSinceEvict = 0

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
  // lastAccess 分钟级精度对 LRU 顺序几乎无影响：60s 内重复命中省掉写事务
  const now = Date.now()
  if (now - entry.lastAccess >= TILE_CACHE_ACCESS_REFRESH_MS) {
    await db.tile_cache.update(key, { lastAccess: now })
  }
  return entry.blob
}

/**
 * 写入瓦片缓存（覆盖同 key 旧值），写入按间隔节流触发 LRU 淘汰。
 *
 * @param db 数据库实例（测试可注入独立实例）
 * @param url 瓦片完整 URL
 * @param blob 瓦片二进制
 */
export async function putCachedTile(db: CyclingDatabase, url: string, blob: Blob): Promise<void> {
  const key = tileCacheKey(url)
  await db.tile_cache.put({ url: key, blob, size: blob.size, lastAccess: Date.now() })
  writesSinceEvict += 1
  if (writesSinceEvict >= TILE_CACHE_EVICT_INTERVAL) {
    writesSinceEvict = 0
    await evictIfNeeded(db)
  }
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
 * 单次按 lastAccess 升序流式遍历完成统计与淘汰定位（每条目逐个反序列化，
 * 内存中只驻留一条），不再先 `each()` 统计又 `toArray()` 把整表 Blob 一次性载入内存。
 *
 * @param db 数据库实例
 * @param limits 缓存上限（缺省用全局默认；测试可传小值低成本触发）
 */
export async function evictIfNeeded(
  db: CyclingDatabase,
  limits?: { maxBytes: number; maxEntries: number },
): Promise<void> {
  const maxBytes = limits?.maxBytes ?? TILE_CACHE_MAX_BYTES
  const maxEntries = limits?.maxEntries ?? TILE_CACHE_MAX_ENTRIES
  const ordered: { url: string; size: number }[] = []
  let count = 0
  let bytes = 0
  await db.tile_cache.orderBy('lastAccess').each((entry) => {
    count += 1
    bytes += entry.size
    ordered.push({ url: entry.url, size: entry.size })
  })
  if (count <= maxEntries && bytes <= maxBytes) {
    return
  }
  // 沿淘汰顺序（最久未访问在前）累计要删的前缀，直到双上限内
  const toDelete: string[] = []
  for (const entry of ordered) {
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