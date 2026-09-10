#!/usr/bin/env node
/**
 * 录制活动「在线回放」为 1080×1920 竖屏 webm，并写出 marks.json（裁剪依据）。
 *
 * 会临时修改 src/map/TrackReplay.tsx 两处：
 *   1) SPEED_OPTIONS 换成目标倍速（原档位最高 128×，长距离不够用）
 *   2) 注释掉 followCursor(latLng) —— 否则地图缩到街道级并高速平移，轨迹看不出全貌且瓦片跟不上
 *
 * ⚠️ 补丁态绝不能提交进仓库：脚本正常结束会还原，但被 Ctrl+C / 崩溃打断时会残留
 *    （特征：源码里出现 `[replay-video-record]` 标记、SPEED_OPTIONS 只剩单档位）。
 *    每次启动都会先自愈遗留补丁；也可用 `--restore-only` 单独清理。
 *
 * 用法：
 *   node scripts/record-replay.mjs --activity <id> [--speed 1024] [--mode 卫星]
 *   node scripts/record-replay.mjs --restore-only    # 只清理遗留补丁，不录制
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def
}

const ACTIVITY = arg('activity', '')
/** 只还原上次遗留的源码补丁、不录制（脚本被 Ctrl+C 中断后的清理入口） */
const RESTORE_ONLY = argv.includes('--restore-only')
if (!RESTORE_ONLY && ACTIVITY === '') {
  console.error('缺少 --activity <活动id>')
  process.exit(1)
}
/** 从作者快照读活动运动时长（秒），用于按目标成片时长反推倍速 */
function activityDuration(activityId) {
  const p = path.resolve('public/author-data/activities.json')
  if (!fs.existsSync(p)) return 0
  const list = JSON.parse(fs.readFileSync(p, 'utf8'))
  const hit = list.find((a) => a.id === activityId)
  return hit === undefined ? 0 : Number(hit.duration) || 0
}

const TARGET_SEC = Number(arg('target', '0'))
const EXPLICIT_SPEED = arg('speed', '')
const autoSpeed = activityDuration(ACTIVITY) / (TARGET_SEC > 0 ? TARGET_SEC : 0)
const SPEED =
  EXPLICIT_SPEED !== ''
    ? EXPLICIT_SPEED
    : TARGET_SEC > 0 && autoSpeed > 0
      ? String(Math.max(2, Math.round(autoSpeed)))
      : '1024'
const MAP_MODE = arg('mode', '')
const BASE = arg('base', 'http://localhost:5173')
const OUT_ROOT = path.resolve(arg('out', '.workbuddy/exports'))
const HOLD_MS = Number(arg('hold', '3000'))
const USE_TILE_PROXY = MAP_MODE !== '' && MAP_MODE !== '正常'
/** 浏览器通道：留空则用 Playwright 自带 Chromium，未下载时回退系统 Chrome */
const CHANNEL = arg('channel', '')
const HEADED = argv.includes('--headed')
/** 瓦片体检不通过时的最大尝试次数（每次换新 context 重录，见 SKILL.md「黑瓦片」） */
const MAX_ATTEMPTS = Math.max(1, Number(arg('attempts', '3')))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 启动浏览器：优先 Playwright 自带 Chromium；未 `npx playwright install` 过时回退系统 Chrome。
 *
 * 自带 Chromium 未下载是这台机器的常态（报 "Executable doesn't exist at ...ms-playwright"），
 * 回退后行为一致，只是版本跟随本机 Chrome。
 *
 * @returns 浏览器实例
 */
async function launchBrowser() {
  const args = ['--window-size=1080,1976']
  const headless = !HEADED
  if (CHANNEL !== '') {
    return chromium.launch({ headless, args, channel: CHANNEL })
  }
  try {
    return await chromium.launch({ headless, args })
  } catch (err) {
    console.log('[warn] Playwright 自带 Chromium 不可用，回退系统 Chrome：', String(err).split('\n')[0])
    return chromium.launch({ headless, args, channel: 'chrome' })
  }
}

/**
 * 录制期需要临时改动的源码与替换规则，录制前统一应用、结束后（含异常）还原。
 *
 * 为什么必须改：
 * 1) `SPEED_OPTIONS` 原档位最高 128×，200km+ 的长途要 4 分半才播完；
 * 2) `followCursor` 一旦跟随就把地图缩到街道级并高速平移，轨迹看不出全貌且瓦片追不上（全黑）。
 *
 * ⚠️ 不要在这里加回 `ActivityMap.tsx` 的补丁：该项目 2.56.0 起 `FitBounds` 已原生监听 Leaflet
 * `resize` 重新 `fitBounds`（正是为了解决「全屏后容器变大却不重算」），补丁规则会匹配不到源码而
 * 让脚本 fail-fast。若将来该逻辑再变，也应改项目代码而不是在这里打补丁。
 */
const PATCH_PLAN = [
  {
    label: 'TrackReplay.tsx（倍速档位 + 关闭跟随镜头）',
    file: path.resolve(arg('replay-file', 'src/map/TrackReplay.tsx')),
    rules: [
      {
        re: /const SPEED_OPTIONS = \[[^\]]*\] as const/,
        to: `const SPEED_OPTIONS = [1, 8, 32, ${SPEED}] as const`,
      },
      {
        re: /^([ \t]*)followCursor\(latLng\)[ \t]*$/m,
        to: '$1// followCursor(latLng) // [replay-video-record] 录制期禁用跟随镜头',
      },
    ],
    /**
     * 反向规则：把补丁改回项目原状。
     *
     * 快照还原只在**单次进程内**有效——脚本被 Ctrl+C / 崩溃打断时不会执行 restore，
     * 源码就停在补丁态，下次取到的「original 快照」本身就是脏的，写回也脏。
     * 因此另备一条与快照无关、跨进程可用的还原路径：
     *   1) 每次录制前先 undoPatches()，把遗留补丁清掉再取快照（幂等，不会累积）；
     *   2) `--restore-only` 可单独调用它做清理。
     * undo 的正则刻意写成「只匹配补丁形态」——SPEED 档位限单个数值，故原档位
     * [1, 8, 32, 64, 128] 不会被二次匹配，天然幂等。
     *
     * ⚠️ 尾部必须用 `[^\r\n]*` 而不是 `[^\n]*`：本仓库源码是 CRLF，而 `\r` 属于正则的
     * 行终止符（`$` 能匹配在它之前），若用 `[^\n]*` 会把 `\r` 一起吃进替换结果，
     * 导致还原后该行行尾变成 LF、与文件其余部分不一致。apply 侧不受影响——
     * `[ \t]*$` 终止于 `\r` 之前，`\r\n` 原样保留。
     */
    undo: [
      {
        re: /^([ \t]*)const SPEED_OPTIONS = \[1, 8, 32, [^,\]]+\] as const[ \t]*$/m,
        to: '$1const SPEED_OPTIONS = [1, 8, 32, 64, 128] as const',
      },
      {
        re: /^([ \t]*)\/\/ followCursor\(latLng\) \/\/ \[replay-video-record\][^\r\n]*$/m,
        to: '$1followCursor(latLng)',
      },
    ],
  },
]

/** 反向还原遗留补丁（幂等）：无补丁时不做任何写入 */
function undoPatches() {
  let touched = 0
  for (const target of PATCH_PLAN) {
    const before = fs.readFileSync(target.file, 'utf8')
    let out = before
    for (const rule of target.undo) {
      out = out.replace(rule.re, rule.to)
    }
    if (out !== before) {
      fs.writeFileSync(target.file, out)
      console.log(`[undo] ${target.label}（清理上次遗留的补丁）`)
      touched += 1
    }
  }
  return touched
}

// 先清掉上次遗留的补丁，再取快照——否则快照本身是脏的，restorePatches 会把脏源码写回
undoPatches()

if (RESTORE_ONLY) {
  console.log('[done] 源码补丁已还原，未录制')
  process.exit(0)
}

for (const target of PATCH_PLAN) {
  target.original = fs.readFileSync(target.file, 'utf8')
}

/** 应用补丁；任一条未命中即抛错，避免"静默没改到" */
function applyPatches() {
  for (const target of PATCH_PLAN) {
    let out = target.original
    for (const rule of target.rules) {
      if (!rule.re.test(out)) {
        throw new Error(`${target.label}: 规则未命中 ${rule.re}`)
      }
      out = out.replace(rule.re, rule.to)
    }
    fs.writeFileSync(target.file, out)
    console.log(`[patch] ${target.label}`)
  }
}

function restorePatches() {
  for (const target of PATCH_PLAN) {
    if (fs.readFileSync(target.file, 'utf8') !== target.original) {
      fs.writeFileSync(target.file, target.original)
      console.log(`[restore] ${target.label}`)
    }
  }
}

/**
 * 单次录制尝试：开新 context 走完「导航 → 在线回放 → 底图 → 全屏 → 等瓦片」，
 * 体检通过才播放（不通过则直接放弃这个 context，让上层换新 context 重试）。
 *
 * 每次尝试用**全新 context**（而非新 page）：context 独立，IndexedDB 瓦片缓存、
 * 连接池、HTTP 缓存全部重置，重下的瓦片最干净。
 *
 * @param browser 浏览器实例
 * @param useTileProxy 是否需要把本地矢量瓦片转发成在线卫星瓦片
 * @returns 体检结果与（播放过的话）marks / 视频路径
 */
async function recordAttempt(browser, useTileProxy) {
  // 录到 raw/ 子目录：体检不过的废片也落在这里，不会和最终成片混在一起
  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    recordVideo: { dir: RAW_DIR, size: { width: 1080, height: 1920 } },
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  // headless 下 Fullscreen 按「屏幕尺寸」渲染，不声明就会只渲染成一小块
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1080,
    height: 1920,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 1080,
    screenHeight: 1920,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  })

  // 非「正常」底图：绕过本地矢量瓦片预缓存（它不区分底图模式，会污染卫星画面）
  if (useTileProxy) {
    let hits = 0
    await page.route('**/author-data/tiles/**', async (route) => {
      const m = route.request().url().match(/(\d+)\/(\d+)\/(\d+)\.png/)
      if (m === null) {
        await route.abort()
        return
      }
      hits += 1
      const [, z, x, y] = m
      const sub = 1 + (hits % 4)
      // route.continue 不允许跨协议改写，必须 fetch + fulfill
      const response = await route.fetch({
        url: `https://webst0${sub}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`,
      })
      await route.fulfill({ response })
    })
    console.log('[bypass] 本地矢量瓦片将转发为在线卫星瓦片')
  }

  // 假光标：让录屏有"人在操作"的观感（Playwright 自身不录鼠标）
  await page.addInitScript(() => {
    const mount = () => {
      let el = document.getElementById('__vc')
      if (el) return el
      el = document.createElement('div')
      el.id = '__vc'
      el.style.cssText = [
        'position:fixed', 'left:0', 'top:0', 'width:28px', 'height:28px',
        'z-index:2147483647', 'pointer-events:none',
        'transition:transform .85s cubic-bezier(.22,.61,.36,1)',
        'transform:translate(270px,480px)',
        'filter:drop-shadow(0 2px 6px rgba(0,0,0,.55))',
      ].join(';')
      el.innerHTML =
        '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 2.5 19 13l-6.2 1.1 3.3 6.6-2.6 1.2-3.3-6.6L5 19.6z" fill="#fff" stroke="#111" stroke-width="1.3"/></svg>'
      document.body.appendChild(el)
      return el
    }
    window.__vcMove = (x, y) => {
      mount().style.transform = `translate(${x - 4}px, ${y - 2}px)`
    }
    window.__vcPress = (on) => {
      const el = mount()
      el.style.width = on ? '24px' : '28px'
      el.style.height = on ? '24px' : '28px'
    }
    document.addEventListener('DOMContentLoaded', mount)
  })

  const marks = {}
  const t0 = Date.now()
  const mark = (key) => {
    marks[key] = (Date.now() - t0) / 1000
    console.log(`[mark] ${key} @ ${marks[key].toFixed(2)}s`)
  }

  console.log('[nav]', `${BASE}/activities/${ACTIVITY}`)
  await page.goto(`${BASE}/activities/${ACTIVITY}`, { waitUntil: 'domcontentloaded', timeout: 90000 })

  const map = page.locator('.leaflet-container').first()
  await map.waitFor({ state: 'attached', timeout: 60000 })
  await sleep(9000)
  await map.scrollIntoViewIfNeeded()
  await sleep(2500)

  const moveTo = async (locator) => {
    const box = await locator.boundingBox()
    if (box === null) return
    await page.evaluate(
      ([x, y]) => window.__vcMove(x, y),
      [box.x + box.width / 2, box.y + box.height / 2],
    )
    await sleep(700)
  }
  const clickWithCursor = async (locator, label) => {
    await moveTo(locator)
    await page.evaluate(() => window.__vcPress(true))
    await locator.click()
    await sleep(140)
    await page.evaluate(() => window.__vcPress(false))
    console.log(`[click] ${label}`)
  }

  const replayBtn = page.getByRole('button', { name: '在线回放' })
  await replayBtn.waitFor({ state: 'visible', timeout: 60000 })
  mark('showStart')
  await clickWithCursor(replayBtn.first(), '在线回放')

  const bar = page.locator('.track-replay')
  await bar.waitFor({ state: 'visible', timeout: 30000 })
  await sleep(900)

  const speedBtn = bar.getByRole('button', { name: `${SPEED}×`, exact: true })
  if ((await speedBtn.count()) > 0) {
    await clickWithCursor(speedBtn.first(), `${SPEED}×`)
  } else {
    console.log(`[warn] 未找到 ${SPEED}× 按钮`)
  }
  await sleep(600)

  if (MAP_MODE !== '') {
    const modeBtn = bar.getByRole('button', { name: MAP_MODE, exact: true })
    if ((await modeBtn.count()) > 0) {
      await clickWithCursor(modeBtn.first(), `底图:${MAP_MODE}`)
      await sleep(2000)
    } else {
      console.log('[warn] 未找到底图模式按钮', MAP_MODE)
    }
  }

  const fsBtn = page.getByRole('button', { name: '全屏查看' })
  if ((await fsBtn.count()) > 0) {
    await clickWithCursor(fsBtn.first(), '全屏')
    await sleep(1200)
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(() => window.dispatchEvent(new Event('resize')))
      await sleep(600)
    }
    console.log('[fullscreen]', await page.evaluate(() => document.fullscreenElement !== null))
    let prev = -1
    let stable = 0
    for (let i = 0; i < 40; i += 1) {
      await sleep(500)
      const n = await page.evaluate(
        () => document.querySelectorAll('.leaflet-tile-loaded').length,
      )
      if (n === prev) {
        stable += 1
        if (stable >= 5) {
          console.log('[tiles] 稳定于', n, '张')
          break
        }
      } else {
        stable = 0
      }
      prev = n
    }
    await sleep(1500)
  } else {
    console.log('[warn] 未找到全屏按钮')
  }

  /**
   * 数出「坏掉」的瓦片。
   *
   * Leaflet 的瓦片一旦加载失败就**永久放弃**：既不会自己重试，也不会重新请求，
   * 深色页面背景直接透出来，成片里就是一块纯黑斑（实测一次录制黑掉 10/40 块）。
   * `naturalWidth === 0` 同时覆盖「请求失败」与「响应体为空」两种坏法——
   * 注意仍在请求中的瓦片也满足该条件，所以必须先等瓦片数量稳定再调用。
   */
  const countBrokenTiles = () =>
    page.evaluate(
      () =>
        Array.from(document.querySelectorAll('.leaflet-tile')).filter(
          (el) => el.naturalWidth === 0,
        ).length,
    )

  await sleep(1500)
  let broken = await countBrokenTiles()
  if (broken > 0) {
    // 给慢瓦片一点时间；仍未加载出来就认定是真失败
    await sleep(4000)
    broken = await countBrokenTiles()
  }
  const total = await page.evaluate(() => document.querySelectorAll('.leaflet-tile').length)
  console.log(`[tiles] 体检：${total} 张瓦片，其中 ${broken} 张没加载出来`)

  // 体检不通过：放弃这个 context（视频留给上层丢弃），换新 context 重录。
  // 不用「派发 resize / 切底图重画」修补：实测 resize 不触发重下（新增请求 0），
  // 也不保证能清掉坏瓦片；换 context 才是确定有效的手段。
  if (broken > 0) {
    await ctx.close()
    return { broken, marks: null, videoPath: null }
  }

  const playBtn = bar.locator('button').first()
  await clickWithCursor(playBtn, '播放')
  mark('playStart')

  const clock = bar.locator('.track-replay__clock')
  let last = null
  let stableCount = 0
  for (let i = 0; i < 240; i += 1) {
    await sleep(500)
    const txt = (await clock.count()) > 0 ? await clock.first().textContent() : null
    if (txt !== null && txt === last) {
      stableCount += 1
      if (stableCount >= 4) break
    } else {
      stableCount = 0
    }
    last = txt
    if (i % 10 === 0 && txt !== null) console.log(`  [clock] ${txt}`)
  }
  mark('playEnd')
  console.log('[clock final]', last)

  await sleep(HOLD_MS)
  mark('showEnd')

  const video = page.video()
  await ctx.close()
  return { broken, marks, videoPath: await video.path() }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT_DIR = path.join(OUT_ROOT, `take-${stamp}`)
/** 原始录屏目录：每次尝试一个 webm，体检不过的废片也留在这一层，绝不删除 */
const RAW_DIR = path.join(OUT_DIR, 'raw')
fs.mkdirSync(RAW_DIR, { recursive: true })

console.log(`[run] 倍速 ${SPEED}× · 底图 ${MAP_MODE === '' ? '正常' : MAP_MODE} · 输出 ${OUT_DIR}`)
applyPatches()

let browser
try {
  browser = await launchBrowser()

  let last = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) console.log(`[attempt] 第 ${attempt}/${MAX_ATTEMPTS} 次尝试`)
    const result = await recordAttempt(browser, USE_TILE_PROXY)
    if (result.marks !== null) {
      last = result
      break
    }
    console.log(
      `[retry] 第 ${attempt} 次尝试底图有 ${result.broken} 张黑瓦片，整页重录（废片不影响成片，开头会被裁掉）`,
    )
  }

  if (last === null) {
    throw new Error(`连续 ${MAX_ATTEMPTS} 次尝试底图都有黑瓦片，放弃录制；稍后重跑一次通常即可`)
  }

  const finalPath = path.join(OUT_DIR, `replay-${ACTIVITY.slice(0, 8)}.webm`)
  fs.renameSync(last.videoPath, finalPath)
  fs.writeFileSync(
    path.join(OUT_DIR, 'marks.json'),
    JSON.stringify(
      { activity: ACTIVITY, speed: SPEED, mapMode: MAP_MODE, marks: last.marks, video: finalPath },
      null,
      2,
    ),
  )
  console.log('[done]', finalPath)
  console.log('[next] render-video.mjs --take', OUT_DIR)
} finally {
  if (browser !== undefined) await browser.close()
  restorePatches()
}
