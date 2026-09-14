/**
 * AI 解读本地缓存（AI 接入 v1）。
 *
 * 按活动缓存解读文本：同一活动第二次打开直接展示已生成的解读，
 * 不重复请求、不重复计费。存 localStorage（key：cycling-ai-insight-cache），
 * 与 AI Key 同理不进 Dexie settings 表（避免随 JSON 备份导出）。
 *
 * 缓存键只含活动 id——解读是「这一次骑行」的解释，模型或提示词升级后
 * 旧文案依旧成立；用户想刷新可在详情页点「重新解读」覆盖。
 */

/** localStorage 存储键 */
const CACHE_STORAGE_KEY = 'cycling-ai-insight-cache'

/** 缓存条目上限（超出时淘汰最早的写入；单条解读几十字，50 次足够翻旧账） */
const CACHE_MAX_ENTRIES = 50

/** 单条缓存记录 */
interface InsightCacheEntry {
  /** 解读文本 */
  text: string
  /** 写入时间（ISO 串，淘汰排序用） */
  at: string
}

/** 全量缓存结构（活动 id → 条目） */
type InsightCacheMap = Record<string, InsightCacheEntry>

/**
 * 读取某次活动的已缓存解读。
 *
 * @param activityId 活动 id
 * @returns 解读文本；无缓存返回 undefined
 */
export function getCachedInsight(activityId: string): string | undefined {
  const text = loadCache()[activityId]?.text
  return text !== undefined && text.length > 0 ? text : undefined
}

/**
 * 读取任意缓存键的文本（v4 内容面增强复用同一 KV 存储）。
 *
 * @param key 缓存键（如 `insights:${activityId}`）
 */
export function getCachedText(key: string): string | undefined {
  return getCachedInsight(key)
}

/**
 * 写入任意缓存键的文本。
 *
 * @param key 缓存键
 * @param text 文本
 */
export function setCachedText(key: string, text: string): void {
  setCachedInsight(key, text)
}

/**
 * 写入/更新某次活动的解读缓存（超限时淘汰最早写入的条目）。
 *
 * @param activityId 活动 id
 * @param text 解读文本
 */
export function setCachedInsight(activityId: string, text: string): void {
  if (activityId.length === 0 || text.trim().length === 0) {
    return
  }
  const cache = loadCache()
  cache[activityId] = { text, at: new Date().toISOString() }
  const keys = Object.keys(cache)
  if (keys.length > CACHE_MAX_ENTRIES) {
    keys
      .sort((a, b) => cache[a].at.localeCompare(cache[b].at))
      .slice(0, keys.length - CACHE_MAX_ENTRIES)
      .forEach((key) => delete cache[key])
  }
  saveCache(cache)
}

/** 读取并校验 localStorage 里的缓存（脏数据按空缓存处理） */
function loadCache(): InsightCacheMap {
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY)
    if (raw === null) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, InsightCacheEntry] =>
        typeof entry[1] === 'object' &&
        entry[1] !== null &&
        typeof (entry[1] as InsightCacheEntry).text === 'string' &&
        typeof (entry[1] as InsightCacheEntry).at === 'string',
    )
    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

/** 写回 localStorage（配额溢出等异常静默放弃——缓存缺失只影响成本，不影响功能） */
function saveCache(cache: InsightCacheMap): void {
  try {
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // 存储配额满/隐私模式：放弃缓存，下次重新生成
  }
}
