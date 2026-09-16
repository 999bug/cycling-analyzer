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

/** 缓存上限（字节 / 条数） */
export interface TileCacheLimits {
  /** 字节上限 */
  maxBytes: number
  /** 条数上限 */
  maxEntries: number
}

/**
 * 生效中的缓存上限。
 *
 * 硬编码 100MB 在 iOS/Safari 上常远超浏览器实际配额（部分环境下限仅几十 MB），
 * 因此启动时按 `navigator.storage.estimate()` 的配额下调（见 negotiateTileCacheLimits）。
 */
let effectiveLimits: TileCacheLimits = {
  maxBytes: TILE_CACHE_MAX_BYTES,
  maxEntries: TILE_CACHE_MAX_ENTRIES,
}

/** 瓦片缓存占用浏览器总配额的比例上限：给活动数据与逐点序列留足空间 */
export const TILE_CACHE_QUOTA_RATIO = 0.2

/** 字节下限：即便浏览器配额极小也保留一点离线能力 */
export const TILE_CACHE_MIN_BYTES = 8 * 1024 * 1024

/**
 * 写入熔断标志：配额写满后本会话不再尝试写库。
 *
 * 不熔断的话，每张新瓦片都会走一次注定失败的写事务（含整表淘汰扫描），
 * 在配额耗尽的设备上表现为持续卡顿且日志刷屏。
 */
let writesDisabled = false

/**
 * 瓦片缓存当前是否可写（配额写满后为 false）。
 *
 * @returns 是否仍应尝试写入缓存
 */
export function isTileCacheWritable(): boolean {
  return !writesDisabled
}

/**
 * 恢复瓦片缓存写入（清空缓存后调用：配额已释放，可重新尝试）。
 */
export function resumeTileCacheWrites(): void {
  writesDisabled = false
}

/**
 * 取生效中的缓存上限。
 *
 * @returns 当前上限（未协商过则为硬上限）
 */
export function getTileCacheLimits(): TileCacheLimits {
  return { ...effectiveLimits }
}

/**
 * 读取浏览器存储配额（字节）；不可用时返回 undefined。
 */
async function readStorageQuota(): Promise<number | undefined> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
    return undefined
  }
  try {
    const estimate = await navigator.storage.estimate()
    if (typeof estimate.quota === 'number' && estimate.quota > 0) {
      return estimate.quota
    }
  } catch {
    // 配额 API 被隐私模式/权限策略禁用：沿用硬上限，不影响缓存能力本身
  }
  return undefined
}

/**
 * 按浏览器实际配额协商缓存上限（启动时调用一次）。
 *
 * 取「配额 × 比例」与硬上限的较小值，并用下限兜底，避免配额极小时缓存完全失效。
 *
 * @returns 协商后的上限
 */
export async function negotiateTileCacheLimits(): Promise<TileCacheLimits> {
  const quota = await readStorageQuota()
  const maxBytes =
    quota === undefined
      ? TILE_CACHE_MAX_BYTES
      : Math.min(TILE_CACHE_MAX_BYTES, Math.max(TILE_CACHE_MIN_BYTES, quota * TILE_CACHE_QUOTA_RATIO))
  effectiveLimits = { maxBytes, maxEntries: TILE_CACHE_MAX_ENTRIES }
  return getTileCacheLimits()
}

/**
 * 判断是否为配额溢出错误。
 *
 * 各浏览器写法不一：Chrome/Firefox 给 name，Safari 老版本只给 code，
 * 故两者都认（22 = QUOTA_EXCEEDED_ERR，1014 = NS_ERROR_DOM_QUOTA_REACHED）。
 *
 * @param error 写库抛出的错误
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as { name?: unknown; code?: unknown }
  return (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 ||
    candidate.code === 1014
  )
}

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
  // 熔断：配额写满后不再尝试，避免每张瓦片都走一次注定失败的写事务
  if (writesDisabled) {
    return
  }
  const key = tileCacheKey(url)
  try {
    await db.tile_cache.put({ url: key, blob, size: blob.size, lastAccess: Date.now() })
  } catch (error) {
    // 缓存写失败不影响瓦片显示：静默降级为「本次不缓存」。
    // 配额溢出则熔断整个会话的写入，其它错误（如数据库关闭）只跳过本次。
    if (isQuotaExceededError(error)) {
      writesDisabled = true
      console.warn('Tile cache quota exceeded, cache writes disabled until the cache is cleared')
      return
    }
    console.warn('Failed to write tile cache', error)
    return
  }
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
  // 清空后配额已释放，恢复写入（否则清空操作反而让缓存永久停摆）
  resumeTileCacheWrites()
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
  const maxBytes = limits?.maxBytes ?? effectiveLimits.maxBytes
  const maxEntries = limits?.maxEntries ?? effectiveLimits.maxEntries
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