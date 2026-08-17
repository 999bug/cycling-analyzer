/**
 * Playwright E2E 配置（后续工作项：E2E 测试）。
 *
 * 覆盖核心链路：页面加载 → 导航 → FIT 文件导入 → 列表 → 详情。
 * webServer 自动起 Vite dev server（dev basename '/'，与生产 /cycling-analyzer 区分）。
 * 仅在本地运行（npm run test:e2e），不进 CI deploy 工作流。
 */
import { defineConfig } from '@playwright/test'

/** dev server 端口 */
const DEV_PORT = 5173

export default defineConfig({
  testDir: './e2e',
  // 单 worker：IndexedDB 按域名共享，并行用例会互相污染数据
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${String(DEV_PORT)}`,
    headless: true,
  },
  webServer: {
    command: `npm run dev -- --port ${String(DEV_PORT)} --strictPort`,
    url: `http://localhost:${String(DEV_PORT)}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
