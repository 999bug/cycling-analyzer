/**
 * 自定义 Service Worker（vite-plugin-pwa injectManifest 模式）。
 *
 * 更新体验核心：导航请求网络优先（NetworkFirst）——在线时每次页面加载
 * 都拉取最新 index.html（其中引用新版哈希资源），用户刷新一次即得新版，
 * 无需提示条点击、也不会"刷新五六次才生效"；离线时逐级兜底保证可用：
 * ①该路由上次成功拉取的 HTML → ②预缓存的 SPA 壳（深链离线可达）。
 *
 * SW 自身仍走浏览器标准更新流：导航时比对 sw.js 字节 → 新 SW 后台
 * install（预缓存新版资源）→ skipWaiting + clientsClaim 立即激活 →
 * cleanupOutdatedCaches 清理旧预缓存，全程静默。
 */

/// <reference lib="webworker" />

// 进程内全局 self 指代 SW 作用域（仅本文件生效，不影响 DOM 侧类型）
declare const self: ServiceWorkerGlobalScope & {
  /** vite-plugin-pwa 构建时注入的预缓存清单 */
  __WB_MANIFEST: ReadonlyArray<{ url: string; revision: string | null }>
}

import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

/** 导航请求网络响应超时（毫秒）：弱网/挂起时 3 秒后回退缓存，不让用户干等 */
const NAV_TIMEOUT_MS = 3000

/** 导航 HTML 运行时缓存名：只存 200 响应（每次刷新被最新 HTML 覆盖） */
const HTML_CACHE_NAME = 'html-shell'

/** 懒加载 chunk 运行时缓存名：与旧 generateSW 配置一致（SWR 静默更新） */
const LAZY_ASSETS_CACHE_NAME = 'lazy-assets'

/** 懒加载 chunk 缓存条目上限，防止长期使用后无限膨胀 */
const LAZY_ASSETS_MAX_ENTRIES = 60

// 预缓存应用壳资源（清单由构建注入；author-data 与大体积懒加载 chunk
// 已在 vite.config injectManifest.globIgnores 排除，运行时按需请求）
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA 壳地址：预缓存清单中的 index.html 条目（相对 SW 脚本解析）。
// workbox 以 __WB_REVISION__ 修订键存储预缓存条目，普通 caches.match
// 命不中，必须走 createHandlerBoundToURL 官方映射
const serveShell = createHandlerBoundToURL('index.html')

registerRoute(
  // 所有页面导航（含刷新/深链/首次加载）走网络优先
  new NavigationRoute(async ({ event, request, url }) => {
    const cache = await caches.open(HTML_CACHE_NAME)
    const cached = await cache.match(request.url)
    try {
      // AbortSignal.timeout 需 Safari 16+/Chrome 103+：旧浏览器不传超时
      // 直连网络（兜底链仍然有效），避免 API 缺失同步抛错导致永远拿缓存旧版
      const init: RequestInit | undefined =
        typeof AbortSignal.timeout === 'function'
          ? { signal: AbortSignal.timeout(NAV_TIMEOUT_MS) }
          : undefined
      const network = await fetch(request, init)
      if (network.status === 200) {
        // 最新 HTML 入缓存（以 URL 字符串为键，规避 navigate 模式 Request 的
        // Cache.put 限制）；每次在线刷新都会覆盖为最新版本
        await cache.put(request.url, network.clone())
        return network
      }
    } catch {
      // 网络异常（离线/超时/挂起）：落入下方兜底链
    }
    // 回退缓存的同时后台静默 revalidate（SWR）：本次先给旧版保证可用，
    // 缓存已被最新 HTML 覆盖，下次刷新即是新版——发版后最多"旧一次"
    event.waitUntil(
      fetch(request)
        .then((res) => {
          if (res.status === 200) {
            return cache.put(request.url, res.clone())
          }
        })
        .catch(() => {}),
    )
    if (cached) {
      return cached
    }
    // 缓存中无该路由 HTML（离线首访或深链）：回退预缓存 SPA 壳
    // （清单必含 index.html，serveShell 缺失即抛错属异常兜底）
    return serveShell({ event, request, url })
  }),
)

// 未预缓存的构建产物（大体积懒加载 chunk）走 SWR 运行时缓存：
// 首次在线使用后离线可用，后台静默更新；已预缓存资源由 precache
// 路由优先接管不受影响。正则由 SW scope 推导，与部署子路径解耦。
registerRoute(
  new RegExp(
    `^${self.registration.scope.replace(/[/\\]/g, '\\$&')}assets/[^/]+\\.(js|css)$`,
  ),
  new StaleWhileRevalidate({
    cacheName: LAZY_ASSETS_CACHE_NAME,
    plugins: [new ExpirationPlugin({ maxEntries: LAZY_ASSETS_MAX_ENTRIES })],
  }),
)

// 新 SW install 完成后，由 vite-plugin-pwa（registerType: 'autoUpdate'）
// 发送 SKIP_WAITING 消息触发立即接管，激活后自动清理旧缓存
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
clientsClaim()
