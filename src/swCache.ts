/**
 * Service Worker 运行时缓存策略（从 `src/sw.ts` 抽出，便于单测）。
 *
 * 抽出的原因：`src/sw.ts` 依赖 ServiceWorkerGlobalScope 与 workbox 运行时，
 * jsdom 里跑不起来；而「缓存条数上限怎么算、哪些缓存该清」是纯逻辑，
 * 值得被测试覆盖。sw.ts 只负责调用。
 *
 * ⚠️ 同源风险：GitHub Pages 用户站是**同源共享**（`<user>.github.io` 下所有仓库
 * 同一个 origin），而 CacheStorage 按 origin 隔离、不按路径隔离。因此
 * **绝不能**无差别删除「不认识的缓存」——那会把同源的其它应用一起清掉。
 * 清理只允许针对本应用自有前缀（见 `isPrunableCache`）。
 */

/** 导航 HTML 运行时缓存名（每次在线刷新覆盖为最新版） */
export const HTML_SHELL_CACHE_NAME = 'html-shell'

/** 懒加载 chunk 运行时缓存名（SWR 静默更新） */
export const LAZY_ASSETS_CACHE_NAME = 'lazy-assets'

/**
 * 导航 HTML 缓存条目上限。
 *
 * 每访问一个不同 URL 的页面就多一条（深链会让 URL 数量继续涨），
 * 不设上限等于把缓存当无限容器用——所以每次写入后按插入序淘汰最旧的。
 */
export const HTML_SHELL_MAX_ENTRIES = 20

/** 懒加载 chunk 缓存条目上限，防止长期使用后无限膨胀 */
export const LAZY_ASSETS_MAX_ENTRIES = 60

/**
 * 本应用自有缓存名前缀。
 * 新增/重命名运行时缓存时，把旧名前缀留在这里，激活时即可清理旧版本遗留。
 */
export const OWN_RUNTIME_CACHE_PREFIXES: readonly string[] = [
  HTML_SHELL_CACHE_NAME,
  LAZY_ASSETS_CACHE_NAME,
]

/** 当前版本在用的运行时缓存名（清理时予以保留） */
export const CURRENT_RUNTIME_CACHE_NAMES: readonly string[] = [
  HTML_SHELL_CACHE_NAME,
  LAZY_ASSETS_CACHE_NAME,
]

/**
 * 判断一个缓存名是否属于本应用（按自有前缀识别）。
 *
 * @param cacheName 缓存名
 * @returns 是否为本应用自有缓存
 */
export function isOwnRuntimeCache(cacheName: string): boolean {
  return OWN_RUNTIME_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix))
}

/**
 * 判断一个缓存是否应在 SW 激活时清理。
 *
 * 判据：是**本应用自有**的，且不在当前版本的使用清单里（即旧版本遗留）。
 * 不认识的名字一律保留——同源可能有别的应用（见文件头同源风险说明）。
 *
 * @param cacheName 缓存名
 * @returns 是否应删除
 */
export function isPrunableCache(cacheName: string): boolean {
  return isOwnRuntimeCache(cacheName) && !CURRENT_RUNTIME_CACHE_NAMES.includes(cacheName)
}

/**
 * 把缓存裁剪到指定条目上限（按 `Cache.keys()` 的插入序淘汰最旧）。
 *
 * 说明：`cache.put` 命中已有 URL 时是否改变条目次序，规范未强制约定，
 * 所以这里淘汰的是「当前次序下最旧」而非严格 LRU——对导航壳缓存足够，
 * 不值得为精确 LRU 引入额外的时间戳索引。
 *
 * @param cache 目标缓存
 * @param maxEntries 条目上限（<= 0 时不裁剪）
 * @returns 实际删除的条目数
 */
export async function trimCache(cache: Cache, maxEntries: number): Promise<number> {
  if (maxEntries <= 0) {
    return 0
  }
  const keys = await cache.keys()
  const overflow = keys.length - maxEntries
  if (overflow <= 0) {
    return 0
  }
  let removed = 0
  for (const request of keys.slice(0, overflow)) {
    if (await cache.delete(request)) {
      removed += 1
    }
  }
  return removed
}
