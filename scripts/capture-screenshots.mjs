/**
 * README 截图生成脚本（本地工具，不进 CI）。
 *
 * 访问线上站点（https://999bug.github.io/cycling-analyzer/）逐个页面截图，
 * 活动 ID 从线上快照 activities.json 读取（取最近一次骑行），保证详情页截图有真实数据。
 *
 * 用法：node scripts/capture-screenshots.mjs [--dir docs/screenshots]
 * 前置：npx playwright install chromium
 */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

/** 线上站点根地址 */
const SITE_URL = 'https://999bug.github.io/cycling-analyzer'

/** 截图页面清单（路径 → 输出文件名） */
const PAGES = [
  { path: '/', file: 'dashboard.png' },
  { path: '/activities', file: 'list.png' },
  { path: '/statistics', file: 'statistics.png' },
  { path: '/calendar', file: 'calendar.png' },
  { path: '/heatmap', file: 'heatmap.png' },
  { path: '/year-review', file: 'year-review.png' },
  { path: '/segments', file: 'segments.png' },
]

/** 截图输出目录（默认 docs/screenshots） */
const outDir = resolve(process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : 'docs/screenshots')

/**
 * 等待页面渲染稳定：地图瓦片/图表动画需要时间，按页面类型给足等待。
 */
async function settle(page, path) {
  const mapLike = path === '/heatmap' || path === '/segments'
  const chartHeavy = path === '/' || path === '/statistics' || path === '/calendar' || path === '/year-review'
  if (mapLike) {
    await page.waitForTimeout(5000)
  } else if (chartHeavy) {
    await page.waitForTimeout(3000)
  } else {
    await page.waitForTimeout(2000)
  }
}

/**
 * 从线上快照获取最近一次活动的详情页地址。
 */
async function fetchLatestActivityUrl() {
  const res = await fetch(`${SITE_URL}/author-data/activities.json`)
  if (!res.ok) {
    return undefined
  }
  const summaries = await res.json()
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return undefined
  }
  return `/activities/${summaries[0].id}`
}

/**
 * 截取全部页面。
 */
async function captureAll() {
  await mkdir(outDir, { recursive: true })
  // 国内直连 GitHub Pages 不稳定：支持通过 HTTPS_PROXY 环境变量走代理
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
  const browser = await chromium.launch({ proxy: proxyUrl ? { server: proxyUrl } : undefined })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

  const detailPath = await fetchLatestActivityUrl()
  const targets = detailPath !== undefined ? [{ path: detailPath, file: 'detail.png' }, ...PAGES] : PAGES

  for (const { path, file } of targets) {
    await page.goto(`${SITE_URL}${path}`, { waitUntil: 'networkidle' })
    await settle(page, path)
    await page.screenshot({ path: resolve(outDir, file), fullPage: false })
    console.log(`Captured ${file} <- ${path}`)
  }

  await browser.close()
  console.log(`\nAll screenshots saved to ${outDir}`)
}

captureAll().catch((error) => {
  console.error('Screenshot capture failed:', error)
  process.exit(1)
})
