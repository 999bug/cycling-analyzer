import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '@/app/App'
import { initTheme } from '@/features/settings/theme'
import { initSidebarMode } from '@/features/settings/sidebar'
import { initCyclingScope } from '@/features/activity/cyclingScope'
import { initDataSource } from '@/stores/dataSourceStore'
import { clearLegacyMapModeMemory } from '@/map/tileSources'
import '@/index.css'

// GitHub Pages 部署在子路径（仓库名）下，路由需带前缀；
// 本地 dev 无前缀。仓库改名时同步更新此常量。
const ROUTER_BASENAME = import.meta.env.PROD ? '/cycling-analyzer' : '/'

// PWA 注册移至 UpdateBanner 组件内的 useSWUpdate hook（布置加载时/每小时/
// 切回标签页的 sw.js 检查）。更新策略为导航网络优先 + SW 静默激活（见 src/sw.ts），
// 横幅仅在极端情况下兜底出现，常态不可见

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

// 启动时恢复侧边栏行为偏好（默认固定常驻；自动收回时延迟收起）
void initSidebarMode()

// 清掉历史版本留下的底图模式记忆：2.62.0 起底图模式改为页面内生效，
// 旧键 cycling-map-mode 不再被读取（不清理会一直留在用户浏览器里）
clearLegacyMapModeMemory()

// 启动时恢复统计口径偏好：默认只统计骑行，非骑行活动（跑步/散步等）
// 不进统计页、仪表盘、热力图等骑行语义页面（列表页始终可见可按类型筛选）
void initCyclingScope()

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
