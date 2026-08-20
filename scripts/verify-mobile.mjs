/**
 * 移动端布局验证脚本（本地工具）：Playwright 模拟 iPhone 视口截图。
 * 校验抽屉导航 + 内容区不被挤压。
 * 用法：node scripts/verify-mobile.mjs
 */
import { chromium } from '@playwright/test'

const BASE = 'http://localhost:4173/cycling-analyzer/'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)

  // 汉堡按钮可见
  const menuButton = page.getByRole('button', { name: '打开菜单' })
  const visible = await menuButton.isVisible()
  console.log('menu button visible:', visible)

  // 顶栏品牌可见
  const topbarLogo = page.getByAltText('骑了么 logo').first()
  console.log('topbar logo visible:', await topbarLogo.isVisible())

  // 默认侧边栏处于收起（visual: sidebar displaced）
  const sidebar = page.locator('.app-layout__sidebar')
  const bb = await sidebar.boundingBox()
  console.log('sidebar box (default):', bb ? `${Math.round(bb.x)}x${Math.round(bb.y)}` : 'hidden')

  await page.screenshot({ path: 'docs/screenshots/mobile-dashboard-default.png' })

  // 打开抽屉
  await menuButton.click()
  await page.waitForTimeout(400)
  const bb2 = await sidebar.boundingBox()
  console.log('sidebar box (open):', bb2 ? `${Math.round(bb2.x)}x${Math.round(bb2.y)}` : 'hidden')
  await page.screenshot({ path: 'docs/screenshots/mobile-drawer-open.png' })

  // 导航到骑行记录
  await page.getByRole('link', { name: '骑行记录' }).click()
  await page.waitForTimeout(1200)
  // 导航后抽屉应已关闭
  console.log('menu expanded after nav:', await menuButton.getAttribute('aria-expanded'))
  await page.screenshot({ path: 'docs/screenshots/mobile-list.png' })

  // 详情页
  const firstLink = page.locator('a[href*="/activities/"]').first()
  if (await firstLink.count()) {
    await firstLink.click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'docs/screenshots/mobile-detail.png', fullPage: false })
  }
} finally {
  await browser.close()
}