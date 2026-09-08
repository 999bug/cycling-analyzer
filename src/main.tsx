import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from '@/app/App'
import { initTheme } from '@/features/settings/theme'
import { initDataSource } from '@/stores/dataSourceStore'
import '@/index.css'

// GitHub Pages 部署在子路径（仓库名）下，路由需带前缀；
// 本地 dev 无前缀。仓库改名时同步更新此常量。
const ROUTER_BASENAME = import.meta.env.PROD ? '/cycling-analyzer' : '/'

// PWA：注册 Service Worker（离线可用 + 新版本自动更新）
registerSW({ immediate: true })

// 发版兜底：部署更新后，旧页面/PWA 快照引用的哈希 chunk 已在服务器删除，
// 动态 import（GPX/FIT 解析器等懒加载模块）会 404 报
// "Failed to fetch dynamically imported module"。监听 Vite 预加载错误，
// 自动刷新一次以加载与线上一致的最新版本（会话标记防循环刷新）。
window.addEventListener('vite:preloadError', () => {
  const flag = 'qileme:preloadReloaded'
  if (!sessionStorage.getItem(flag)) {
    sessionStorage.setItem(flag, '1')
    window.location.reload()
  }
})
// 应用正常加载完成后清除标记：本次会话后续发版仍可触发一次自动恢复
window.setTimeout(() => sessionStorage.removeItem('qileme:preloadReloaded'), 10_000)

// 启动时恢复持久化主题（规格 §36，异步应用，失败回退默认深色）
void initTheme()

// 启动时探测作者数据快照（manifest.json）：成功则默认展示作者数据，
// 失败（本地 dev 未生成快照等）静默回退本地数据源
void initDataSource()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
