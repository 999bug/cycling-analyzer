import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// 应用版本号（取自 package.json，define 注入供页面显示）
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // 生产构建必须用绝对 base：404.html 还原深链 URL 后（如 /cycling-analyzer/activities/xxx），
  // 相对 base './' 会让 ./assets 解析到 /cycling-analyzer/activities/assets 而 404 白屏；
  // dev 保持 '/'，与 main.tsx 的 ROUTER_BASENAME 规则一致。
  // base 变量同时供 PWA start_url/scope 使用（仓库子路径部署）。
  const base = command === 'build' ? '/cycling-analyzer/' : '/'

  return {
    base,
    plugins: [
      react(),
      VitePWA({
      // 自动更新：新版本发布后 SW 立即接管并提示刷新
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'qileme.png'],
      // Web 应用清单（PWA 离线可用：图标/独立窗口/主题色）
      manifest: {
        name: '骑了么 · 看懂你的每一次骑行',
        short_name: '骑了么',
        description: '个人骑行数据分析网站：FIT 解析、统计图表、路线地图与训练洞察',
        lang: 'zh-CN',
        theme_color: '#0a4268',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: `${base}`,
        scope: `${base}`,
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${base}icons/icon-maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 预缓存应用壳资源；注意排除体积庞大的作者数据快照（运行时按需网络请求）
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/author-data/**'],
        // SPA 路由回退：离线时深链（如 /activities/xxx）返回 index.html
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/cycling-analyzer\/author-data\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // 版本号注入（侧边栏显示；bundle 内直接内联字符串，无运行时 JSON 加载）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: true,
    // e2e/ 为 Playwright 用例（.spec.ts），不走 Vitest
    exclude: ['e2e/**', 'node_modules/**'],
  },
  }
})
