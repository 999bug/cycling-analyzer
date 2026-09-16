/**
 * README 界面预览截图生成脚本（本地工具，不进 CI）。
 *
 * 默认访问本地 dev 服务（http://localhost:5173，dev 下 basename 为 '/'），
 * 也可用 `--base https://999bug.github.io/cycling-analyzer` 指向线上站点。
 * 活动 ID 从作者快照 `author-data/activities.json` 读取（取最近一次骑行），
 * 保证详情页截图有真实数据。
 *
 * 用法：
 *   npm run dev                                  # 另开一个终端起本地服务
 *   node scripts/capture-screenshots.mjs         # 全套 21 张 → docs/screenshots/骑了么/
 *   node scripts/capture-screenshots.mjs --only 15-分享素材
 *
 * 前置：npx playwright install chromium
 */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

/** 站点根地址（默认本地 dev；线上需带仓库子路径） */
const BASE = argValue('--base') ?? 'http://localhost:5173'

/** 截图输出目录（README 引用的编号目录） */
const OUT_DIR = resolve('docs/screenshots/骑了么')

/** 视口（与 README 既有截图口径一致：1440×900 @2x） */
const VIEWPORT = { width: 1440, height: 900 }

/**
 * 演示用 AI 配置（仅本地截图用假 Key）。
 * 未配置供应商时全部 AI 入口不渲染，拍不到「✦ AI 解读」入口，故注入一份假配置；
 * 该 Key 只存在于本次截图的浏览器上下文里，不写入任何文件。
 */
const DEMO_AI_CONFIG = JSON.stringify({
  state: {
    profiles: [
      {
        id: 'ai-demo',
        name: '示例供应商',
        vendorId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-demo-not-a-real-key',
        model: 'deepseek-chat',
      },
    ],
    activeProfileId: 'ai-demo',
    maxOutputTokens: 9999,
  },
  version: 1,
})

/**
 * 截图步骤清单（顺序即文件编号顺序）。
 *
 * path: 'detail' = 作者快照里最近一次活动的详情页；其余为站点根下的路径；
 * nav: 改用「先进首页 → 点侧边栏导航」的站内跳转（推荐，理由见下）；
 * title: 期望的页面 h1，用于断言没拍错页；
 * ready: 页面渲染完成的信号选择器（dev 冷启动编译慢，必须等它出现再操作）；
 * scroll: 滚动到该选择器（目标区块落进视口）；
 * click: 点击该按钮文字（打开弹窗 / 开启回放 / 切换板块）；
 * hover: 悬停该选择器（日历悬浮详情卡需要）；
 * tiles: 是否需要等地图瓦片稳定；
 * settle: 该步额外等待毫秒数（图表动画 / 弹窗打开）。
 *
 * 为什么不直接深链跳各页面：GitHub Pages 上没有 history fallback，深链要先经 404.html
 * 还原、还会被 SW 缓存影响，实测线上多处深链会落到**错误的页面**（/routes-map 渲染出
 * 训练计划；该错位源于 App.tsx 用 ROUTES[下标] 引用路径，2026-09-16 已改为具名常量修复）。
 * 站内导航点击走 React Router，不经过还原逻辑，稳定且正确。
 */
const DETAIL_READY = 'section[aria-label="核心指标"]'

const STEPS = [
  { file: '1-首页.png', path: '/', title: '仪表盘', settle: 3000 },
  { file: '2-骑行记录页.png', nav: '骑行记录', title: '骑行记录', settle: 2000 },
  { file: '3-数据地图.png', path: 'detail', ready: DETAIL_READY, scroll: '.leaflet-container', tiles: true, settle: 2500 },
  { file: '4-分段详情和爬坡与分段分析.png', path: 'detail', ready: DETAIL_READY, scroll: '[aria-label="分段详情"]', tiles: true, settle: 2500 },
  { file: '5-训练区间.png', path: 'detail', ready: DETAIL_READY, scroll: '[aria-label="训练区间"]', tiles: true, settle: 2500 },
  { file: '6-活动对比.png', path: 'detail', ready: DETAIL_READY, scroll: '[aria-label="活动对比"]', tiles: true, settle: 2500 },
  { file: '7-统计页面.png', nav: '统计', title: '统计', ready: 'h1', settle: 3000 },
  { file: '8-日历.png', nav: '日历', title: '日历', ready: '.calendar-heatmap', hover: '.calendar-heatmap [role="button"]', settle: 2500 },
  { file: '9-骑行热力图.png', nav: '热力图', title: '骑行热力图', ready: '.leaflet-container', tiles: true, settle: 4000 },
  // 2026-09-16：App.tsx 路由错位（ROUTES[9] 挂错组件）已修，下面三条改回站内 nav 点击
  { file: '10-路线图.png', nav: '路线图', title: '骑行路线图', ready: '.routes-map-page', tiles: true, settle: 5000 },
  { file: '11-年度回顾.png', nav: '年度回顾', title: '年度回顾', ready: 'h1', settle: 3000 },
  { file: '12-同步骑行数据.png', nav: '骑行记录', title: '骑行记录', click: '同步骑行数据', settle: 1800 },
  { file: '13-在线回放.png', path: 'detail', ready: DETAIL_READY, click: '在线回放', tiles: true, settle: 3500 },
  { file: '14-导出GPX和导出回放视频.png', path: 'detail', ready: DETAIL_READY, click: '生成竖屏视频', settle: 2000 },
  { file: '15-分享素材.png', path: 'detail', ready: DETAIL_READY, click: '分享', tiles: true, settle: 4000 },
  { file: '17-热门路线.png', nav: '路线图', title: '骑行路线图', ready: '.routes-map-page__switch', click: '热门路线', tiles: true, settle: 5000 },
  { file: '18-赛段页面.png', nav: '赛段', title: '赛段', ready: 'h1', settle: 6000 },
  { file: '19-训练计划.png', nav: '训练计划', title: '训练计划', ready: 'h1', settle: 2500 },
  { file: '20-表现趋势.png', nav: '表现趋势', title: '表现趋势', ready: 'h1', settle: 3000 },
  { file: '21-更多设置页.png', nav: '更多', title: '更多', ready: 'h1', settle: 2000 },
]

/** 需要注入演示 AI 配置的步骤（单独上下文，避免污染其它页面截图） */
const AI_STEPS = [
  { file: '16-AI解读.png', path: 'detail', ready: DETAIL_READY, scroll: '[aria-label="骑行洞察"]', scrollBlock: 'center', settle: 2500 },
]

/** 读取命令行参数值（`--base http://...`） */
function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** 只跑指定文件（`--only 15` 按文件名前缀匹配，便于单张重拍） */
function onlyFilter(file) {
  const only = argValue('--only')
  return only === undefined || file.startsWith(only)
}

/** 站点是否为本机 dev（决定要不要预热编译） */
function isLocalBase() {
  return BASE.includes('localhost') || BASE.includes('127.0.0.1')
}

/** 页面路径解析：'detail' → 最近一次活动详情页 */
function resolvePath(path, detailPath) {
  return path === 'detail' ? detailPath : path
}

/** 从作者快照取最近一次活动 ID（详情页截图用） */
async function fetchLatestActivityPath() {
  const res = await fetch(`${BASE}/author-data/activities.json`)
  if (!res.ok) {
    throw new Error(`author-data/activities.json ${res.status}`)
  }
  const summaries = await res.json()
  if (!Array.isArray(summaries) || summaries.length === 0) {
    throw new Error('author snapshot is empty')
  }
  // 快照按开始时间倒序，取第一条即最近一次骑行
  return `/activities/${summaries[0].id}`
}

/**
 * 等地图瓦片稳定：轮询已加载瓦片计数，连续两次不变即认为稳定。
 * 没有瓦片元素时立即放行（无地图页面不白等）。
 */
async function waitForTiles(page, timeoutMs = 15000) {
  const start = Date.now()
  let last = -1
  let stable = 0
  while (Date.now() - start < timeoutMs) {
    let count
    try {
      count = await page.evaluate(() => document.querySelectorAll('.leaflet-tile-loaded').length)
    } catch {
      // 深链还原期间可能还有一次导航，执行上下文被销毁——等它落定后重试
      await page.waitForTimeout(500)
      continue
    }
    if (count > 0 && count === last) {
      stable += 1
      if (stable >= 2) {
        return
      }
    } else {
      stable = 0
    }
    last = count
    await page.waitForTimeout(500)
  }
}

/**
 * 轮询等待选择器出现。
 *
 * 刻意不用 `locator.waitFor()`：本机实测该调用在元素已存在（`count() > 0`）时仍会挂到超时，
 * 用计数轮询最稳。
 */
async function waitForSelector(page, selector, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await page.locator(selector).first().count()) > 0) {
      return
    }
    await page.waitForTimeout(300)
  }
  throw new Error(`selector not found: ${selector}`)
}

/**
 * 按可见文字找按钮：不用 getByRole 的 exact 名匹配——
 * 有些按钮文字带符号前缀（如「▶ 在线回放」），exact 匹配会落空；
 * 同时 :visible 过滤掉移动端导航里同名但被媒体查询隐藏的按钮（点它必然超时）。
 */
async function clickButton(page, text, timeoutMs = 20000) {
  await waitForSelector(page, `button:visible:has-text("${text}")`, timeoutMs)
  await page.locator('button:visible').filter({ hasText: text }).first().click({ timeout: timeoutMs })
}

/** 滚动到目标（用 evaluate 而非 scrollIntoViewIfNeeded，后者对长页元素同样会挂） */
async function scrollTo(page, selector, block = 'start', timeoutMs = 20000) {
  await waitForSelector(page, selector, timeoutMs)
  await page.evaluate(
    (args) => {
      document.querySelector(args.selector)?.scrollIntoView({ block: args.block, behavior: 'instant' })
    },
    { selector, block },
  )
  await page.waitForTimeout(600)
}

/**
 * 导航并容错重试。
 *
 * 用 `commit` 而不是 `domcontentloaded`：GitHub Pages 的深链要先被 404.html 还原成
 * `?/path` 再跳到 index.html，一次 goto 期间会发生二次跳转，等 domcontentloaded 会报
 * 「interrupted by another navigation」。commit 提交即返回，后续靠信号选择器等渲染。
 */
async function gotoWithRetry(page, url, attempts = 3) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 45000 })
      // 深链还原后还有一次 SPA 内部跳转，给它落定的时间
      await page.waitForTimeout(1200)
      return
    } catch (error) {
      lastError = error
      await page.waitForTimeout(1000)
    }
  }
  throw lastError
}

/** 侧边栏导航点击：站内跳转，绕开 GitHub Pages 的深链还原与 SW 缓存 */
async function clickNav(page, label) {
  await waitForSelector(page, 'nav[aria-label="主导航"]')
  await page
    .locator('nav[aria-label="主导航"] a')
    .filter({ hasText: label })
    .first()
    .click({ timeout: 20000 })
  await page.waitForTimeout(1000)
}

/** 断言当前页面标题，防止静默拍到错误页面 */
async function assertTitle(page, expected, file) {
  const titles = await page.locator('h1').allTextContents()
  if (!titles.some((title) => title.includes(expected))) {
    throw new Error(`${file}: expected h1 containing "${expected}", got ${JSON.stringify(titles)}`)
  }
}

/** 单步执行：导航 → 等渲染完成 → 交互 → 等瓦片 → 截图 */
async function runStep(page, step, detailPath) {
  const target = resolvePath(step.path, detailPath)

  if (step.nav !== undefined) {
    // 站内跳转：先落在首页，再点侧边栏（深链在 Pages 上可能落到错误的页面）
    await gotoWithRetry(page, `${BASE}/`)
    await clickNav(page, step.nav)
  } else {
    await gotoWithRetry(page, `${BASE}${target}`)
  }

  // dev 冷启动要现场编译路由 chunk，首次进页可能十几秒，等信号选择器出现再动
  if (step.ready !== undefined) {
    await waitForSelector(page, step.ready)
  }

  if (step.title !== undefined) {
    await assertTitle(page, step.title, step.file)
  }
  await page.waitForTimeout(600)

  if (step.click !== undefined) {
    await clickButton(page, step.click)
    await page.waitForTimeout(800)
  }

  if (step.scroll !== undefined) {
    await scrollTo(page, step.scroll, step.scrollBlock ?? 'start')
  }

  if (step.hover !== undefined) {
    await waitForSelector(page, step.hover)
    await page.locator(step.hover).first().hover({ timeout: 20000 })
    await page.waitForTimeout(400)
  }

  if (step.tiles === true) {
    await waitForTiles(page)
  }

  await page.waitForTimeout(step.settle ?? 1500)
  await page.screenshot({ path: resolve(OUT_DIR, step.file), fullPage: false })
  console.log(`captured ${step.file} <- ${target}`)
}

/** 建一个注入了演示 AI 配置的上下文（AI 入口需配置存在才渲染） */
async function createAiContext(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
  await context.addInitScript((config) => {
    window.localStorage.setItem('cycling-ai-config', config)
  }, DEMO_AI_CONFIG)
  return context
}

/** 主流程：每张截图独立上下文——热力图/路线图等重页面会留下 rAF 与大量图层，
 *  共用同一个 page 会把渲染线程拖死，后续页面连 h1 都渲染不出来 */
async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  // 国内直连 GitHub Pages 不稳定：支持通过 HTTPS_PROXY 环境变量走代理
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy
  const browser = await chromium.launch({ proxy: proxyUrl ? { server: proxyUrl } : undefined })

  const detailPath = await fetchLatestActivityPath()
  console.log(`latest activity: ${detailPath}`)

  // 预热只对本地 dev 有意义（首次进重页面要现场编译）；线上是构建产物，预热反而会触发 SPA 内部跳转打断导航
  if (isLocalBase()) {
    const warmContext = await browser.newContext({ viewport: VIEWPORT })
    const warmPage = await warmContext.newPage()
    for (const warm of [detailPath, '/routes-map', '/heatmap', '/calendar', '/activities']) {
      await warmPage.goto(`${BASE}${warm}`, { waitUntil: 'commit', timeout: 60000 })
      await warmPage.waitForTimeout(3000)
    }
    await warmContext.close()
    console.log('warm-up done')
  }

  const failures = []
  const steps = [...STEPS, ...AI_STEPS].sort((a, b) => a.file.localeCompare(b.file, 'zh'))
  for (const step of steps) {
    if (!onlyFilter(step.file)) {
      continue
    }
    const context = AI_STEPS.includes(step) ? await createAiContext(browser) : await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    try {
      const stepPage = await context.newPage()
      await runStep(stepPage, step, detailPath)
    } catch (error) {
      failures.push(`${step.file}: ${error.message}`)
      console.error(`failed ${step.file}: ${error.message}`)
    } finally {
      await context.close()
    }
  }

  await browser.close()

  if (failures.length > 0) {
    console.error(`\n${failures.length} step(s) failed:`)
    for (const failure of failures) {
      console.error(` - ${failure}`)
    }
    process.exitCode = 1
    return
  }
  console.log(`\nall screenshots saved to ${OUT_DIR}`)
}

main().catch((error) => {
  console.error('screenshot capture failed:', error)
  process.exit(1)
})
