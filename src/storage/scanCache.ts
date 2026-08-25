/**
 * 全量逐点扫描缓存键与持久化缓存（性能优化）。
 *
 * 统计页/热力图/赛段页需扫描全部活动的逐点数据，离开再回来重扫导致卡顿。
 * 逐点记录导入后不可变，任何新增/删除活动都会改变活动数、总距离或最新开始时间,
 * 故「数量|总距离|最新开始时间|名称哈希」可作为安全的内容指纹失效缓存。
 *
 * 持久化缓存（v4 scan_cache 表）：热力图/路线图的抽稀产物写入 IndexedDB，
 * 页面刷新后首次进入不再重扫（模块级内存缓存刷新即失效，IndexedDB 跨会话存活）。
 */
import { db, type ScanCacheEntity } from '@/storage/db'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/** 扫描缓存名：热力图抽稀轨迹 */
export const SCAN_CACHE_HEATMAP = 'heatmap-tracks'

/** 扫描缓存名：路线图路线聚类结果 */
export const SCAN_CACHE_ROUTES_MAP = 'routes-map'

/** 简单字符串哈希（djb2）：活动名称纳入指纹用（重命名后地图标题需刷新） */
function hashString(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * 计算活动集合的内容指纹（扫描缓存键）。
 *
 * @param summaries 全部活动摘要
 * @returns 缓存键字符串（空集合返回固定值 '0|0||'）
 */
export function summariesScanKey(summaries: readonly ActivitySummary[]): string {
  let latestStartTime = ''
  let totalDistance = 0
  let namesHash = ''
  for (const summary of summaries) {
    totalDistance += summary.distance
    if (summary.startTime > latestStartTime) {
      latestStartTime = summary.startTime
    }
    namesHash += summary.name ?? ''
  }
  return `${summaries.length}|${totalDistance}|${latestStartTime}|${hashString(namesHash)}`
}

/**
 * 读取持久化扫描缓存。
 *
 * @param name 缓存名（SCAN_CACHE_* 常量）
 * @param fingerprint 当前活动集合内容指纹（不匹配视为失效并清除旧记录）
 * @returns 缓存产物；无记录或指纹失配返回 null
 */
export async function loadScanCache<T>(name: string, fingerprint: string): Promise<T | null> {
  const entry: ScanCacheEntity | undefined = await db.scan_cache.get(name)
  if (entry === undefined) {
    return null
  }
  if (entry.fingerprint !== fingerprint) {
    // 指纹失配：旧缓存已失效，删除避免堆积
    void db.scan_cache.delete(name).catch((error: unknown) => {
      console.error('Failed to delete stale scan cache', error)
    })
    return null
  }
  return entry.payload as T
}

/**
 * 写入持久化扫描缓存（覆盖同名记录）。
 *
 * @param name 缓存名
 * @param fingerprint 活动集合内容指纹
 * @param payload 扫描产物
 */
export async function saveScanCache(name: string, fingerprint: string, payload: unknown): Promise<void> {
  const entry: ScanCacheEntity = { name, fingerprint, payload }
  try {
    await db.scan_cache.put(entry)
  } catch (error: unknown) {
    // 缓存写入失败不阻塞主流程（下次进入重扫即可）
    console.error('Failed to save scan cache', error)
  }
}
