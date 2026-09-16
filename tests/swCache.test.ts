/**
 * Service Worker 缓存策略测试（src/swCache.ts）。
 *
 * 覆盖两件事：
 * - 哪些缓存允许在激活时清理（**必须**只限本应用自有前缀——GitHub Pages
 *   用户站同源共享 CacheStorage，误删会连累同源其它应用）
 * - html-shell 的条目上限裁剪（缓存曾随访问过的路由 URL 无上限增长）
 */
import { describe, expect, it } from 'vitest'
import {
  HTML_SHELL_CACHE_NAME,
  HTML_SHELL_MAX_ENTRIES,
  isOwnRuntimeCache,
  isPrunableCache,
  LAZY_ASSETS_CACHE_NAME,
  trimCache,
} from '@/swCache'

/**
 * 构造只实现 trimCache 所需方法的假缓存（keys 按插入序 / delete 命中即移除）。
 *
 * 注：Request 需绝对 URL（测试环境用的是 Node 的 undici 实现，相对 URL 会抛
 * ERR_INVALID_URL），故这里统一加前缀。
 *
 * @param paths 初始条目路径（按插入顺序）
 */
function fakeCache(paths: readonly string[]): {
  cache: Cache
  remaining: () => string[]
} {
  const absolutize = (path: string) => new URL(path, 'https://example.test').href
  const entries = paths.map(absolutize)
  const cache = {
    keys: async () => entries.map((url) => new Request(url)),
    delete: async (request: Request) => {
      const index = entries.indexOf(request.url)
      if (index === -1) {
        return false
      }
      entries.splice(index, 1)
      return true
    },
  } as unknown as Cache
  return { cache, remaining: () => entries.map((url) => new URL(url).pathname) }
}

describe('SW 运行时缓存归属判定', () => {
  it('当前在用的缓存不算「旧版本遗留」，不得清理', () => {
    expect(isPrunableCache(HTML_SHELL_CACHE_NAME)).toBe(false)
    expect(isPrunableCache(LAZY_ASSETS_CACHE_NAME)).toBe(false)
  })

  it('自有前缀但已不在使用清单的缓存（重命名后的旧名）应清理', () => {
    expect(isPrunableCache(`${HTML_SHELL_CACHE_NAME}-v1`)).toBe(true)
    expect(isPrunableCache(`${LAZY_ASSETS_CACHE_NAME}-2025`)).toBe(true)
  })

  it('非自有缓存一律保留（同源可能还有别的应用，误删会连累它们）', () => {
    expect(isOwnRuntimeCache('some-other-app-shell')).toBe(false)
    expect(isPrunableCache('some-other-app-shell')).toBe(false)
    expect(isPrunableCache('workbox-precache-v2-https://example.github.io/')).toBe(false)
    expect(isPrunableCache('html')).toBe(false)
  })
})

describe('trimCache 条目上限', () => {
  it('未超限时不动任何条目', async () => {
    const { cache, remaining } = fakeCache(['/a', '/b'])

    const removed = await trimCache(cache, 5)

    expect(removed).toBe(0)
    expect(remaining()).toEqual(['/a', '/b'])
  })

  it('恰好等于上限时不删除（边界：不应多删一条）', async () => {
    const { cache, remaining } = fakeCache(['/a', '/b', '/c'])

    await trimCache(cache, 3)

    expect(remaining()).toHaveLength(3)
  })

  it('超限时按插入序淘汰最旧的，保留最新 maxEntries 条', async () => {
    const { cache, remaining } = fakeCache(['/a', '/b', '/c', '/d', '/e'])

    const removed = await trimCache(cache, 3)

    expect(removed).toBe(2)
    expect(remaining()).toEqual(['/c', '/d', '/e'])
  })

  it('上限非正数视为不裁剪（避免误配置把缓存清空）', async () => {
    const { cache, remaining } = fakeCache(['/a', '/b'])

    expect(await trimCache(cache, 0)).toBe(0)
    expect(remaining()).toEqual(['/a', '/b'])
  })

  it('默认上限足够容纳常见页面数，且不至于无限增长', () => {
    expect(HTML_SHELL_MAX_ENTRIES).toBeGreaterThan(0)
    expect(HTML_SHELL_MAX_ENTRIES).toBeLessThanOrEqual(50)
  })
})
