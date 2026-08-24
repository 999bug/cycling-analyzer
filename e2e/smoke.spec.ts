/**
 * E2E 冒烟测试（后续工作项：E2E 测试）。
 *
 * 覆盖核心链路：应用加载与导航 → FIT 文件导入 → 骑行记录列表 → 详情页。
 * 数据存于浏览器 IndexedDB（本机 profile 隔离，每用例前清空）。
 */
import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 合成 FIT 样例（含 GPS 轨迹，tests/fixtures 仓库内公开样例） */
const GPS_FIT_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'cycling-gps.fit',
)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // 清空 IndexedDB：E2E 串行（workers=1），用例间互不影响
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('cycling-data')
        request.onsuccess = () => resolve()
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
      }),
  )
  await page.reload()
})

test('应用加载：品牌、导航与空态引导可见', async ({ page }) => {
  // 品牌区：横幅图（alt 文本）
  await expect(page.getByRole('img', { name: '骑了么 logo' })).toBeVisible()
  for (const label of ['仪表盘', '骑行记录', '统计', '日历', '热力图', '年度回顾', '赛段', '设置']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible()
  }
  // 空库：仪表盘显示导入引导
  await expect(page.getByText(/欢迎使用/)).toBeVisible()
})

test('导航：各页面路由可达', async ({ page }) => {
  await page.getByRole('link', { name: '统计' }).click()
  await expect(page).toHaveURL(/\/statistics$/)
  await expect(page.getByRole('heading', { name: '统计' })).toBeVisible()

  await page.getByRole('link', { name: '赛段' }).click()
  await expect(page).toHaveURL(/\/segments$/)
  await expect(page.getByText(/还没有赛段/)).toBeVisible()

  await page.getByRole('link', { name: '设置' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
})

test('核心链路：导入 FIT → 列表 → 详情', async ({ page }) => {
  // 打开导入面板，经隐藏文件输入上传合成 FIT 样例
  await page.getByRole('button', { name: '同步骑行数据' }).click()
  await page.locator('input[accept=".fit,.fit.gz,.gpx"]').setInputFiles(GPS_FIT_FIXTURE)

  // 导入完成后仪表盘出现统计数据（总距离不再是空态）
  await expect(page.getByText(/欢迎使用/)).not.toBeVisible({ timeout: 15_000 })

  // 列表页出现该活动，点击进入详情
  await page.getByRole('link', { name: '骑行记录' }).click()
  await expect(page).toHaveURL(/\/activities$/)
  const row = page.locator('tbody tr').first()
  await expect(row).toBeVisible()
  await row.click()

  // 详情页：标题与指标卡可见
  await expect(page).toHaveURL(/\/activities\//)
  await expect(page.getByText('距离').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '导出 GPX' })).toBeVisible()
})
