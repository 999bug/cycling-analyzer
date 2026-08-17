import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // 生产构建必须用绝对 base：404.html 还原深链 URL 后（如 /cycling-analyzer/activities/xxx），
  // 相对 base './' 会让 ./assets 解析到 /cycling-analyzer/activities/assets 而 404 白屏；
  // dev 保持 '/'，与 main.tsx 的 ROUTER_BASENAME 规则一致。
  base: command === 'build' ? '/cycling-analyzer/' : '/',
  plugins: [react()],
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
}))
