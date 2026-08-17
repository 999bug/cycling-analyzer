import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '@/app/App'
import { initTheme } from '@/features/settings/theme'
import '@/index.css'

// GitHub Pages 部署在子路径（仓库名）下，路由需带前缀；
// 本地 dev 无前缀。仓库改名时同步更新此常量。
const ROUTER_BASENAME = import.meta.env.PROD ? '/cycling-analyzer' : '/'

// 启动时恢复持久化主题（规格 §36，异步应用，失败回退默认深色）
void initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
