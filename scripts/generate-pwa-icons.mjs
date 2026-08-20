/**
 * PWA 图标生成脚本（本地工具，不进 CI）。
 *
 * 把品牌方形图标 SVG（public/icons/qileme-icon.svg，512×512）直接
 * 渲染成 PWA 图标（192/512 + maskable）。源图已是方形，无需裁剪。
 *
 * 用法：node scripts/generate-pwa-icons.mjs
 * 前置：npx playwright install chromium
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

/** 输出图标尺寸配置 */
const ICONS = [
  { file: 'public/icons/icon-192.png', size: 192 },
  { file: 'public/icons/icon-512.png', size: 512 },
  { file: 'public/icons/icon-maskable-512.png', size: 512 },
]

/** 方形图标 SVG（已含品牌深蓝底 + 自行车图形） */
const svgText = readFileSync(resolve('public', 'icons', 'qileme-icon.svg'), 'utf8')

/**
 * 生成单个方形图标：直接渲染方形 SVG。
 */
async function renderIcon(browser, { file, size }) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><html><body style="margin:0">
      <div id="icon" style="width:${size}px;height:${size}px">
        <img id="logo" style="width:${size}px;height:${size}px" alt="">
      </div>
    </body></html>`,
  )
  await page.$eval('#logo', (img, svg) => {
    img.setAttribute('src', `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  }, svgText)
  await page.waitForFunction(() => {
    const img = document.querySelector('#logo')
    return img && img.complete && img.naturalWidth > 0
  })
  await page.screenshot({ path: resolve(file), omitBackground: true })
  await page.close()
}

/** 主流程：启动 chromium 依次生成图标 */
async function main() {
  const browser = await chromium.launch()
  try {
    for (const icon of ICONS) {
      await renderIcon(browser, icon)
      console.log(`Generated ${icon.file} (${icon.size}x${icon.size})`)
    }
  } finally {
    await browser.close()
  }
}

await main()