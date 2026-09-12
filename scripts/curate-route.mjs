/**
 * 精选路线半自动添加器：一张「路线需求单」→ 锚点定位 → 路网拉取 → 自动例外探测 →
 * 选路自诊断 → 几何/数据/测试文件自动更新 + 几何预览。
 *
 * 用法：
 *   node scripts/curate-route.mjs --spec <spec.json 路径或内联 JSON> [--dry] [--force]
 *
 * 需求单字段（JSON）：
 *   id           生成脚本短名（如 wts），必填
 *   region       地区 ID（beijing/xian/...），必填；新地区需同时给 regionLabel + entryPrefix
 *   regionLabel  新地区的中文展示名（仅新地区需要，如「上海」）
 *   entryPrefix  数据条目 ID 前缀（仅新地区需要，如 sh）
 *   name/area    路线名与区域卖点（如「梧桐山」/「罗湖」），必填
 *   via          起终点（可含途经点），≥2 个；每项为「地名」字符串（自动 Nominatim 定位）
 *                或 [lat, lng] 坐标，必填
 *   declaredKm   申报里程（km），必填（官方/媒体/社区口径，配 source）
 *   declaredElevM 申报爬升（m），必填
 *   difficulty   1–5，必填
 *   kind         'climb' | 'endurance' | ...,默认 'climb'
 *   source       { text, grade: 'A'|'B'|'C' }，必填
 *   desc/tips    描述与骑行提示，必填
 *   entryId      数据条目 ID 覆盖（默认 <entryPrefix>-<id>）
 *   geometryScope 强制 'full'|'core'（默认按线长/申报比例自动判定：<0.8 记 core）
 *   loop         true 时终点自动回连起点（环线，锚点序列首尾都给或只给一次均可）
 *
 * --dry：只写 .tmp/curate/<id>/（预览/报告/建议的数据条目与测试补丁），不动 src 与测试。
 * --force：tracks key 已存在时覆盖重算（默认报错退出，防止误伤已上线几何）。
 *
 * 自动例外探测：默认图选路失败时依次尝试 track/trunk 放行与隧道走廊白名单（自动检测
 * 两锚点直线走廊 1.5km 内的隧道名），全部失败时输出「替代锚点建议」诊断报告。
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  REGION_META,
  readExistingOutput,
  renderTracksFile,
  buildGraph,
  graphShortestPath,
  snapNode,
  distM,
  simplify,
  lineLength,
} from './generate-curated-routes.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = resolve(ROOT, process.env.CURATED_CACHE_DIR ?? '.tmp/curated-v2/tmp-overpass')
const OUT_DIR = resolve(ROOT, '.tmp/curate')

/** 地区 → 数据条目归属文件与 tracks 导出名（新地区一律并入 national.ts / nationalTracks.ts） */
const REGION_DATA = {
  beijing: { file: 'src/features/curatedRoutes/beijing.ts', tracksImport: 'BEIJING_TRACKS', entryPrefix: 'bj' },
}
const NATIONAL_PREFIX = {
  xian: 'xa',
  hangzhou: 'hz',
  taizhou: 'tz',
  shenzhen: 'sz',
  chengdu: 'cd',
  kunming: 'km',
}
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
/**
 * 公共 OSM 服务要求可识别的 User-Agent。
 * 实测（2026-09-12）：缺 UA 时 overpass-api.de 返回 406、private.coffee 与 kumi.systems 返回 429，
 * Nominatim 返回 403 —— 三个镜像会全部失败，只剩 curl 兜底可用。
 */
const UA = 'cycling-analyzer-curate/1.0 (curated route pipeline; OSM data)'

// ---- CLI 参数 ----
const args = process.argv.slice(2)
function argOf(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const specArg = argOf('--spec')
const DRY = args.includes('--dry')
const FORCE = args.includes('--force')
const REFETCH = args.includes('--refetch')
if (!specArg) {
  console.error('用法：node scripts/curate-route.mjs --spec <spec.json 路径或内联 JSON> [--dry] [--force]')
  process.exit(1)
}
const spec = JSON.parse(
  existsSync(resolve(specArg)) || !specArg.trim().startsWith('{') ? readFileSync(resolve(specArg), 'utf8') : specArg,
)

const log = []
const say = (line) => {
  log.push(line)
  console.log(line)
}

// ---- 1. 需求单校验 ----
const required = ['id', 'region', 'name', 'area', 'via', 'declaredKm', 'declaredElevM', 'difficulty', 'source', 'desc', 'tips']
for (const key of required) {
  if (spec[key] === undefined || spec[key] === null || spec[key] === '') {
    console.error(`需求单缺少必填字段：${key}`)
    process.exit(1)
  }
}
if (!spec.source?.text || !['A', 'B', 'C'].includes(spec.source.grade)) {
  console.error('source 必须为 { text, grade: "A"|"B"|"C" } —— 没有来源的里程不允许上线')
  process.exit(1)
}
const region = spec.region
const isNewRegion = !REGION_META[region]
if (isNewRegion && (!spec.regionLabel || !spec.entryPrefix)) {
  console.error('新地区必须提供 regionLabel（中文展示名）与 entryPrefix（条目 ID 前缀）')
  process.exit(1)
}
const dataMeta = isNewRegion
  ? { file: 'src/features/curatedRoutes/national.ts', tracksImport: 'NATIONAL_TRACKS', entryPrefix: spec.entryPrefix }
  : REGION_DATA[region] ?? {
      file: 'src/features/curatedRoutes/national.ts',
      tracksImport: 'NATIONAL_TRACKS',
      entryPrefix: NATIONAL_PREFIX[region] ?? spec.entryPrefix ?? region,
    }
const tracksMeta = REGION_META[region] ?? { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' }
// 需求单里的 id 往往已自带地区前缀（nj-laoshan），此时不能再拼一次，否则会生成 nj-nj-laoshan
const prefix = dataMeta.entryPrefix
const bareId = spec.id.startsWith(`${prefix}-`) ? spec.id.slice(prefix.length + 1) : spec.id
const entryId = spec.entryId ?? `${prefix}-${bareId}`
const kind = spec.kind ?? 'climb'
if (spec.difficulty < 1 || spec.difficulty > 5) {
  console.error('difficulty 必须 1–5')
  process.exit(1)
}

// ---- 2. 锚点定位：地名 → Nominatim → Photon 双源兜底，坐标直接用 ----
/** 已知地区中心（geocode 偏置用，防「龙井路」命中江西同名路的歧义坑） */
const REGION_CENTER = {
  beijing: [40.0, 116.1],
  xian: [34.0, 108.8],
  hangzhou: [30.24, 120.13],
  taizhou: [28.85, 121.0],
  shenzhen: [22.58, 114.18],
  chengdu: [30.6, 104.1],
  kunming: [24.98, 102.65],
  // 二期全国扩展：新地区必须登记中心点，否则地名定位会命中同名地点（如「龙井路」命中江西）
  shanghai: [31.2, 121.45],
  nanjing: [32.05, 118.78],
  xiamen: [24.48, 118.09],
  guangzhou: [23.13, 113.26],
  hainan: [19.5, 109.8],
  wuhan: [30.59, 114.3],
  chongqing: [29.56, 106.55],
  dali: [25.6, 100.27],
  qingdao: [36.07, 120.38],
  qinghai: [36.9, 100.5],
}

async function geocodeOne(url, pick) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return pick(await resp.json())
}

async function geocode(name) {
  // via 支持「名称@提示」语法（提示词拼进查询消歧，如「龙井路@杭州」）；
  // 未显式提示时用地区中心做偏置
  const [query, hint] = name.split('@').map((s) => s.trim())
  const center = REGION_CENTER[region]
  const searchText = hint ? `${query} ${hint}` : query
  const providers = []
  if (center) {
    providers.push(() =>
      geocodeOne(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=cn&viewbox=${center[1] - 0.5},${center[0] + 0.5},${center[1] + 0.5},${center[0] - 0.5}&bounded=1&q=${encodeURIComponent(searchText)}`,
        (json) => {
          if (!json.length) throw new Error('无结果')
          return { lat: Number(json[0].lat), lng: Number(json[0].lon), label: json[0].display_name }
        },
      ),
    )
  }
  providers.push(() =>
    geocodeOne(
      // Photon 对多词查询要求全部命中：拼上 hint 反而查不到（实测「佘山地铁站 上海松江」无结果，
      // 单查「佘山地铁站」配合地区中心 bias 命中正常）。故 Photon 只用原名。
      `https://photon.komoot.io/api/?limit=1&lang=default${center ? `&lat=${center[0]}&lon=${center[1]}` : ''}&q=${encodeURIComponent(query)}`,
      (json) => {
        const hit = json.features?.[0]
        if (!hit) throw new Error('无结果')
        const [lng, lat] = hit.geometry.coordinates
        const p = hit.properties
        return { lat, lng, label: [p.name, p.district, p.city, p.state].filter(Boolean).join(' · ') }
      },
    ),
  )
  for (let round = 0; round < 2; round += 1) {
    for (const provider of providers) {
      try {
        return await provider()
      } catch (error) {
        say(`geocode 源失败（${round + 1} 轮）：${error.message}`)
      }
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(
    `地名定位「${name}」失败（各源均不可达/无结果）；可用「名称@城市」消歧或直接给 [lat,lng] 坐标`,
  )
}

const anchors = []
for (const item of spec.via) {
  if (Array.isArray(item) && item.length === 2) {
    anchors.push([item[0], item[1]])
  } else if (typeof item === 'string' && /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(item)) {
    const [lat, lng] = item.split(',').map(Number)
    anchors.push([lat, lng])
  } else {
    const hit = await geocode(item)
    say(`geocode: ${item} → ${hit.lat.toFixed(4)},${hit.lng.toFixed(4)}（${hit.label}）`)
    anchors.push([hit.lat, hit.lng])
  }
}
if (anchors.length < 2) {
  console.error('via 至少需要 2 个点')
  process.exit(1)
}
// 环线：首尾回连
if (spec.loop && distM(anchors[0], anchors[anchors.length - 1]) > 300) {
  anchors.push([...anchors[0]])
  say('loop=true：终点自动回连起点')
}

const execFileP = promisify(execFile)

// ---- 路网拉取（缓存优先 → node fetch 镜像轮询 → curl 兜底；缓存命名对齐 generate 脚本）----
async function fetchWaysMirrors(bbox) {
  const q = `[out:json][timeout:120];way["highway"](${bbox.join(',')});out geom;`
  const parse = (json) => {
    if (!Array.isArray(json.elements)) throw new Error('响应不是 elements 数组（可能被限流返回 XML）')
    return json.elements.filter((el) => el.type === 'way')
  }
  for (const base of OVERPASS_MIRRORS) {
    try {
      const resp = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
        body: new URLSearchParams({ data: q }).toString(),
        signal: AbortSignal.timeout(150_000),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return parse(await resp.json())
    } catch (error) {
      say(`mirror ${new URL(base).host} 失败：${error.message}，换下一个`)
    }
  }
  // node fetch 直连不稳的环境（代理/防火墙）回退 curl（历史验证 --noproxy 最可靠）
  for (const base of OVERPASS_MIRRORS) {
    try {
      const { stdout } = await execFileP(
        'curl.exe',
        ['--noproxy', '*', '--max-time', '150', '-sS', '-A', UA, '-d', `data=${q}`, base],
        { maxBuffer: 64 * 1024 * 1024 },
      )
      return parse(JSON.parse(stdout))
    } catch (error) {
      say(`curl ${new URL(base).host} 失败：${String(error.message).slice(0, 100)}`)
    }
  }
  throw new Error('全部 Overpass 镜像失败')
}

function deriveBbox(anchorsList, padDeg) {
  const lats = anchorsList.map((a) => a[0])
  const lngs = anchorsList.map((a) => a[1])
  return [Math.min(...lats) - padDeg, Math.min(...lngs) - padDeg, Math.max(...lats) + padDeg, Math.max(...lngs) + padDeg]
}

// ---- 4. 例外探测与选路 ----
/** 点到线段距离（米，等距圆柱近似） */
function distToSegmentM(p, a, b) {
  const cosLat = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  const px = p[1] * 111320 * cosLat
  const py = p[0] * 110540
  const ax = a[1] * 111320 * cosLat
  const ay = a[0] * 110540
  const bx = b[1] * 111320 * cosLat
  const by = b[0] * 110540
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

/** 检测两锚点直线走廊 1.5km 内的隧道名（东方红/松树嘴类「唯一通道」场景） */
function detectTunnelNames(ways, anchorsList) {
  const names = new Set()
  for (const way of ways) {
    const name = way.tags?.name ?? ''
    // 只关心骑行/干线路的隧道（motorway 隧道反正不可骑，不进白名单）
    const hw = way.tags?.highway ?? ''
    if (hw === 'motorway' || hw === 'motorway_link') continue
    if (way.tags?.tunnel !== 'yes' && !/隧道$/.test(name)) continue
    if (!way.geometry) continue
    for (const p of way.geometry) {
      const pt = [p.lat, p.lon]
      for (let i = 1; i < anchorsList.length; i += 1) {
        if (distToSegmentM(pt, anchorsList[i - 1], anchorsList[i]) < 1500) {
          if (name) names.add(name)
          break
        }
      }
    }
  }
  return [...names]
}

function componentOf(adj, start) {
  const seen = new Set([start])
  const queue = [start]
  while (queue.length) {
    const cur = queue.pop()
    for (const [next] of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

/** 单次尝试：返回 { ok, coords } 或 { ok:false, stage, legIndex, suggestions } */
function attemptRoute(ways, anchorsList, opts) {
  const { nodeCoord, adj } = buildGraph(ways, opts)
  const snaps = anchorsList.map((a) => {
    const id = snapNode(nodeCoord, a)
    return { id, d: id < 0 ? Infinity : distM(nodeCoord.get(id), a) }
  })
  if (snaps.some((s) => s.id < 0)) {
    return { ok: false, stage: 'snap', snaps }
  }
  const coords = []
  for (let i = 1; i < anchorsList.length; i += 1) {
    const leg = graphShortestPath(nodeCoord, adj, snaps[i - 1].id, snaps[i].id)
    if (!leg) {
      // 诊断：失败段两端各自所在连通分量互不包含 → 在对方分量里找附近的替代锚点
      const compFrom = componentOf(adj, snaps[i - 1].id)
      const compTo = componentOf(adj, snaps[i].id)
      const near = (anchor, comp, self) =>
        [...nodeCoord.entries()]
          .map(([id, c]) => ({ id, c, d: distM(c, anchor) }))
          .filter((x) => x.d < 1500 && comp.has(x.id) && x.id !== self)
          .sort((a, b) => a.d - b.d)
          .slice(0, 5)
          .map((x) => `${x.c[0].toFixed(4)},${x.c[1].toFixed(4)}`)
      return {
        ok: false,
        stage: 'path',
        legIndex: i - 1,
        suggestions: {
          nearStartInToComp: near(anchorsList[i - 1], compTo, snaps[i - 1].id),
          nearEndInFromComp: near(anchorsList[i], compFrom, snaps[i].id),
        },
      }
    }
    for (const id of leg) {
      const coord = nodeCoord.get(id)
      const last = coords[coords.length - 1]
      if (!last || last[0] !== coord[0] || last[1] !== coord[1]) coords.push(coord)
    }
  }
  return { ok: true, coords }
}

const tunnels = []
let ways = null
let usedBboxPad = null
let chosen = null
let attemptLog = []

const PAD_LADDER = [0.02, 0.05, 0.1]
for (const pad of PAD_LADDER) {
  const bbox = deriveBbox(anchors, pad)
  const cacheFile = resolve(CACHE_DIR, `${spec.id}-all.json`)
  if (pad === PAD_LADDER[0] && existsSync(cacheFile) && !REFETCH) {
    ways = JSON.parse(readFileSync(cacheFile, 'utf8')).elements.filter((el) => el.type === 'way')
    say(`路网缓存命中：${cacheFile}（${ways.length} ways，--refetch 可强制重下）`)
    usedBboxPad = pad
  } else {
    say(`拉取路网：bbox=[${bbox.map((v) => v.toFixed(2)).join(', ')}] pad=${pad}°`)
    try {
      ways = await fetchWaysMirrors(bbox)
    } catch (error) {
      say(`路网拉取彻底失败：${error.message}（稍后重试或手工下载到 ${resolve(CACHE_DIR, `${spec.id}-all.json`)}）`)
      mkdirSync(resolve(OUT_DIR, spec.id), { recursive: true })
      writeFileSync(resolve(OUT_DIR, spec.id, 'report.txt'), log.join('\n'), 'utf8')
      process.exit(2)
    }
    say(`  → ${ways.length} ways`)
    writeFileSync(cacheFile, JSON.stringify({ elements: ways }), 'utf8')
    usedBboxPad = pad
  }

  tunnels.length = 0
  tunnels.push(...detectTunnelNames(ways, anchors))
  if (tunnels.length) say(`走廊内检测到隧道（候选白名单）：${tunnels.join(' / ')}`)

  const attempts = [{ label: '默认路网', opts: {} }]
  if (tunnels.length) attempts.push({ label: `隧道白名单[${tunnels.join('/')}]`, opts: { allowTunnelNames: new Set(tunnels) } })
  attempts.push(
    { label: '放行 track', opts: { allowTrack: true } },
    { label: '放行 trunk', opts: { allowTrunk: true } },
    { label: '隧道+track+trunk 全放行', opts: { allowTunnelNames: new Set(tunnels), allowTrack: true, allowTrunk: true } },
  )
  attemptLog = []
  for (const attempt of attempts) {
    const result = attemptRoute(ways, anchors, attempt.opts)
    if (result.ok) {
      chosen = { ...attempt, coords: result.coords }
      say(`✔ ${attempt.label} 选路成功`)
      break
    }
    const detail =
      result.stage === 'snap'
        ? `锚点吸附失败（${result.snaps.map((s) => (s.id < 0 ? '圈外' : `${s.d.toFixed(0)}m`)).join(' / ')}）`
        : `第 ${result.legIndex + 1} 段不可达`
    attemptLog.push(`${attempt.label}：失败（${detail}）`)
    say(`  ✗ ${attempt.label}：失败（${detail}）`)
    if (result.stage === 'path') chosen = chosen ?? { failedResult: result, attempt: attempt.label }
  }
  if (chosen?.coords) break
  say(`pad=${pad}° 全部尝试失败，扩大 bbox 重试`)
  chosen = null
}

if (!chosen?.coords) {
  say('')
  say('═══ 全部尝试失败 · 诊断报告 ═══')
  for (const line of attemptLog) say(line)
  const failed = chosen?.failedResult
  if (failed?.suggestions) {
    say(`失败段：第 ${failed.legIndex + 1} 段（${anchors[failed.legIndex]} → ${anchors[failed.legIndex + 1]}）`)
    say('起点附近、位于终点连通分量的替代锚点（换锚点重试）：')
    for (const s of failed.suggestions.nearStartInToComp) say(`  [${s}]`)
    say('终点附近、位于起点连通分量的替代锚点：')
    for (const s of failed.suggestions.nearEndInFromComp) say(`  [${s}]`)
  }
  say('常见原因：① OSM 该爬坡路缺失（如白羊沟案例，无法生成）② 锚点在孤立景区分量（换上面建议点）③ bbox 太小')
  // 失败路径不会走到预览目录的 mkdir（预览在成功后才建），此处必须先建再写
  mkdirSync(resolve(OUT_DIR, spec.id), { recursive: true })
  writeFileSync(resolve(OUT_DIR, `${spec.id}`, 'report.txt'), log.join('\n'), 'utf8')
  process.exit(2)
}

// ---- 4b. 爬升估算（可选）----
/**
 * 无权威爬升来源时的兜底：沿几何采样 SRTM 90m 公开高程计算累计爬升。
 * - 重采样步距按线长自适应（上限 400 点），控制公共 API 请求数
 * - 单段高差 < 3m 不计入，滤掉 SRTM 在平原地区的高程噪声（否则爬升会严重虚高）
 * - 结果按 4 位小数坐标缓存，重复跑同一区域不再消耗额度
 */
const ELEV_CACHE_FILE = resolve(ROOT, '.tmp/curated-v2/elev-cache.json')
const ELEV_PROVIDERS = [
  (locs) => `https://api.opentopodata.org/v1/srtm90m?locations=${locs}`,
  (locs) => `https://api.open-elevation.com/api/v1/lookup?locations=${locs}`,
]

function resampleByDistance(line, maxPoints = 400) {
  const total = lineLength(line)
  const step = Math.max(200, Math.ceil(total / maxPoints))
  const out = [line[0]]
  let acc = 0
  for (let i = 1; i < line.length; i += 1) {
    acc += distM(line[i - 1], line[i])
    if (acc >= step) {
      out.push(line[i])
      acc = 0
    }
  }
  const last = line[line.length - 1]
  const tail = out[out.length - 1]
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last)
  return out
}

function loadElevCache() {
  try {
    return JSON.parse(readFileSync(ELEV_CACHE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

async function fetchElevationBatch(points) {
  const locs = points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|')
  for (const build of ELEV_PROVIDERS) {
    try {
      const resp = await fetch(build(locs), { signal: AbortSignal.timeout(30_000) })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const rows = (await resp.json()).results ?? []
      if (rows.length !== points.length) throw new Error('返回点数不符')
      return rows.map((r) => r.elevation)
    } catch (error) {
      say(`  高程源失败：${String(error.message).slice(0, 60)}`)
    }
  }
  return null
}

async function estimateElevationGain(line) {
  const pts = resampleByDistance(line)
  const cache = loadElevCache()
  const keys = pts.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`)
  const missing = keys.map((key, i) => [key, i]).filter(([key]) => cache[key] === undefined)
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100)
    const values = await fetchElevationBatch(batch.map(([, idx]) => pts[idx]))
    if (!values) return null
    batch.forEach(([key], j) => {
      cache[key] = values[j]
    })
    // opentopodata 公共实例限 1 req/s
    if (i + 100 < missing.length) await new Promise((r) => setTimeout(r, 1100))
  }
  mkdirSync(dirname(ELEV_CACHE_FILE), { recursive: true })
  writeFileSync(ELEV_CACHE_FILE, JSON.stringify(cache), 'utf8')
  const hs = keys.map((key) => cache[key]).filter((v) => typeof v === 'number')
  let gain = 0
  let ref = hs[0]
  for (const h of hs) {
    if (h >= ref + 3) {
      gain += h - ref
      ref = h
    } else if (h < ref) ref = h
  }
  return Math.round(gain)
}

// ---- 5. 质检 ----
const simplified = simplify(chosen.coords, 12)
const drawnKm = lineLength(simplified) / 1000
const ratio = drawnKm / spec.declaredKm
const geometryScope = spec.geometryScope ?? (ratio < 0.8 ? 'core' : 'full')
say('')
say(`几何：${simplified.length} pts，${drawnKm.toFixed(2)}km，与申报 ${spec.declaredKm}km 比例 ${ratio.toFixed(2)}`)
say(`geometryScope 自动判定：${geometryScope}${spec.geometryScope ? '（需求单指定）' : ''}`)
if (geometryScope === 'full' && (ratio < 0.45 || ratio > 1.7)) {
  say('⚠ 线长与申报量级偏差过大（full 容差 [0.45, 1.7]）——检查锚点是否绕路/申报口径是否含往返')
}

// 需求单 elevEstimate: true 时，用 SRTM 公开高程覆盖申报爬升（无权威来源时的兜底）
if (spec.elevEstimate === true) {
  const gain = await estimateElevationGain(simplified)
  if (gain === null) {
    say('⚠ 高程服务不可用：爬升仍是需求单原值，请人工补权威数据后再入库')
  } else {
    say(`爬升估算：SRTM 90m 沿几何采样 → ${gain} m（需求单原值 ${spec.declaredElevM} m）`)
    spec.declaredElevM = gain
    spec.source = { ...spec.source, text: `${spec.source.text}；爬升为 SRTM 90m 公开高程估算` }
  }
}

// ---- 6. 产出 ----
const escape = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
function buildEntryText(scope) {
  const lines = [
    '  {',
    `    id: '${escape(entryId)}',`,
    `    name: '${escape(spec.name)}',`,
    `    region: '${region}',`,
    `    area: '${escape(spec.area)}',`,
    `    distanceMeters: ${Math.round(spec.declaredKm * 1000)},`,
    `    elevationGainMeters: ${Math.round(spec.declaredElevM)},`,
    `    difficulty: ${spec.difficulty},`,
    `    kind: '${escape(kind)}',`,
    '    description:',
    `      '${escape(spec.desc)}',`,
    `    tips: '${escape(spec.tips)}',`,
    `    source: '${escape(spec.source.text)}',`,
    `    sourceGrade: '${spec.source.grade}',`,
  ]
  if (scope === 'core') lines.push(`    geometryScope: 'core',`)
  // tracks key 可能含连字符（cd-haute-s1），点号访问是非法 JS，必须改方括号
  const trackRef = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(spec.id)
    ? `.${spec.id}`
    : `['${escape(spec.id)}']`
  lines.push(`    tracks: ${dataMeta.tracksImport}${trackRef} ?? [],`, '  },')
  return lines.join('\n')
}

const entryText = buildEntryText(geometryScope)

// 几何预览（等距圆柱投影 → SVG）
function buildPreviewHtml() {
  const pts = simplified
  const lats = pts.map((p) => p[0])
  const lngs = pts.map((p) => p[1])
  const cosLat = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI / 180)
  const xs = lngs.map((v) => v * cosLat)
  const pad = 30
  const w = 640
  const h = 420
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...lats)
  const y1 = Math.max(...lats)
  const spanX = Math.max(x1 - x0, 1e-6)
  const spanY = Math.max(y1 - y0, 1e-6)
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY)
  const toXY = (p) => [pad + (p[1] * cosLat - x0) * scale, h - pad - (p[0] - y0) * scale]
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toXY(p).map((v) => v.toFixed(1)).join(' ')}`).join(' ')
  const anchorMarks = anchors
    .map((a, i) => {
      const [x, y] = toXY(a)
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#A32D2D"/><text x="${(x + 7).toFixed(1)}" y="${(y - 5).toFixed(1)}" font-size="12" fill="#791F1F">${i + 1}. ${escape(spec.via[i] ?? '')}</text>`
    })
    .join('')
  return `<!doctype html><meta charset="utf-8"><title>curate 预览：${escape(spec.name)}</title>
<body style="font-family:system-ui;margin:16px;background:#fff;color:#1d2b36">
<h2 style="font-size:16px;margin:0 0 4px">${escape(spec.name)}（${region}）几何预览 — 人工审核用</h2>
<p style="font-size:13px;margin:4px 0">画线 ${drawnKm.toFixed(2)}km / 申报 ${spec.declaredKm}km（比例 ${ratio.toFixed(2)}，${geometryScope}）· 例外：${escape(chosen.label)} · OSM 数据 © OpenStreetMap 贡献者</p>
<svg width="${w}" height="${h}" style="border:1px solid #ccc;background:#f6f8f7">
<path d="${path}" fill="none" stroke="#3B6D11" stroke-width="2.5" stroke-linejoin="round"/>
${anchorMarks}
</svg>
<p style="font-size:13px">审核要点：① 线形有没有明显绕路/抄近路 ② 起终点位置对不对 ③ 发卡弯数量与实际爬坡是否符合。</p>
</body>`
}

const outDir = resolve(OUT_DIR, spec.id)
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'preview.html'), buildPreviewHtml(), 'utf8')
// 几何坐标一并落盘：便于外部复核、重算爬升，不必重新拉路网
writeFileSync(resolve(outDir, 'geometry.json'), JSON.stringify(simplified), 'utf8')

// 数据条目与测试补丁说明（dry 模式下只落盘建议文本）
writeFileSync(resolve(outDir, 'proposed-entry.ts'), entryText, 'utf8')

if (DRY) {
  say('')
  say(`[dry] 预览/报告/建议条目已写入 ${outDir}，src 与测试未改动。`)
  say('[dry] 确认无误后去掉 --dry 重跑即正式入库。')
} else {
  // tracks 合并（key 已存在时默认报错，防误伤已上线几何）
  const tracksFile = resolve(ROOT, tracksMeta.file)
  const output = readExistingOutput(tracksFile, tracksMeta.exportName)
  if (output[spec.id] !== undefined && !FORCE) {
    console.error(`tracks key「${spec.id}」已存在；确要覆盖重算请加 --force`)
    process.exit(1)
  }
  output[spec.id] = [simplified]
  writeFileSync(tracksFile, renderTracksFile(tracksMeta.exportName, output), 'utf8')
  say(`✔ tracks 已合并 → ${tracksMeta.file}`)

  // 数据条目追加
  const dataFile = resolve(ROOT, dataMeta.file)
  const dataText = readFileSync(dataFile, 'utf8')
  const insertAt = dataText.lastIndexOf('\n]')
  if (insertAt < 0 || insertAt < dataText.length - 12) {
    console.error(`${dataMeta.file} 结构异常：找不到数组结尾「\\n]」`)
    process.exit(1)
  }
  if (dataText.includes(`id: '${entryId}'`)) {
    console.error(`数据条目 ${entryId} 已存在于 ${dataMeta.file}，请换 id 或先手工处理`)
    process.exit(1)
  }
  writeFileSync(dataFile, `${dataText.slice(0, insertAt)}\n${entryText}${dataText.slice(insertAt)}`, 'utf8')
  say(`✔ 数据条目 ${entryId} 已追加 → ${dataMeta.file}`)

  // 测试文件补丁：界框 + key 全集断言 +（新地区）注册表断言
  const testFile = resolve(ROOT, 'tests/features/curatedRoutes/curatedRoutes.test.ts')
  let testText = readFileSync(testFile, 'utf8')

  // 该地区全部路线的实际界框（含新路线）+ 余量
  const regionKeys = new Map()
  for (const m of dataText.matchAll(/region: '(\w+)'[\s\S]*?tracks: (?:BEIJING_TRACKS|NATIONAL_TRACKS)\.(\w+)/g)) {
    if (!regionKeys.has(m[1])) regionKeys.set(m[1], new Set())
    regionKeys.get(m[1]).add(m[2])
  }
  regionKeys.get(region)?.add(spec.id)
  const allPts = []
  for (const key of regionKeys.get(region) ?? []) {
    for (const line of output[spec.id] !== undefined && key === spec.id ? [simplified] : output[key] ?? []) allPts.push(...line)
  }
  if (allPts.length) {
    const latMin = Math.min(...allPts.map((p) => p[0]))
    const latMax = Math.max(...allPts.map((p) => p[0]))
    const lngMin = Math.min(...allPts.map((p) => p[1]))
    const lngMax = Math.max(...allPts.map((p) => p[1]))
    const fmt = (v) => Number(v.toFixed(2))
    const bboxLine = `      ${region}: { lat: [${fmt(latMin - 0.02)}, ${fmt(latMax + 0.02)}], lng: [${fmt(lngMin - 0.02)}, ${fmt(lngMax + 0.02)}] },`
    const bboxRe = new RegExp(`^      ${region}: \\{ lat: \\[[^\\]]*\\], lng: \\[[^\\]]*\\] \\},$`, 'm')
    if (bboxRe.test(testText)) {
      testText = testText.replace(bboxRe, bboxLine)
    } else {
      const anchor = '    }\n    for (const route of ALL_CURATED_ROUTES) {'
      if (!testText.includes(anchor)) {
        console.error('测试 REGION_BBOX 插入点未找到，请手工登记界框')
        process.exit(1)
      }
      // bbox 行必须落在 REGION_BBOX 对象内部（闭合 } 之前），插到 } 之后会产生语法错误
      testText = testText.replace(anchor, `${bboxLine}\n    }\n    for (const route of ALL_CURATED_ROUTES) {`)
    }
    say(`✔ 测试界框已更新（${region}）`)
  }

  const patchKeyList = (text, exportName, keys) => {
    const re = new RegExp(`(expect\\(Object\\.keys\\(${exportName}\\)\\.sort\\(\\)\\)\\.toEqual\\(\\[)[\\s\\S]*?(\\]\\))`)
    if (!re.test(text)) return text
    const body = keys.map((k) => `      '${k}',`).join('\n')
    return text.replace(re, `$1\n${body}\n    $2`)
  }
  if (region === 'beijing') {
    testText = patchKeyList(testText, 'BEIJING_TRACKS', Object.keys(readExistingOutput(tracksFile, tracksMeta.exportName)).sort())
  } else {
    testText = patchKeyList(testText, 'NATIONAL_TRACKS', Object.keys(readExistingOutput(tracksFile, tracksMeta.exportName)).sort())
  }
  say('✔ 测试 key 全集断言已更新')

  if (isNewRegion) {
    // 注册表断言（测试）
    const regRe = /(expect\(CURATED_REGIONS\.map\(\(region\) => region\.id\)\)\.toEqual\(\[)([\s\S]*?)(\]\))/
    if (regRe.test(testText)) {
      testText = testText.replace(regRe, `$1$2      '${region}',\n    $3`)
    }
    // types.ts 联合类型
    const typesFile = resolve(ROOT, 'src/features/curatedRoutes/types.ts')
    let typesText = readFileSync(typesFile, 'utf8')
    const unionRe = /(export type CuratedRegionId =[\s\S]*?)(\n\n)/
    if (!typesText.includes(`| '${region}'`)) {
      // $1 结尾不含换行（被 (\n\n) 捕获），必须显式补 \n，否则拼成 `| 'kunming'  | 'shanghai'` 单行
      typesText = typesText.replace(unionRe, `$1\n  | '${region}'$2`)
      writeFileSync(typesFile, typesText, 'utf8')
      say('✔ CuratedRegionId 已扩展')
    }
    // index.ts 注册表
    const indexFile = resolve(ROOT, 'src/features/curatedRoutes/index.ts')
    let indexText = readFileSync(indexFile, 'utf8')
    if (!indexText.includes(`id: '${region}'`)) {
      const kunmingLine = `  { id: 'kunming', label: '昆明', routes: nationalRoutesOf('kunming') },\n`
      if (!indexText.includes(kunmingLine)) {
        console.error('index.ts 注册表插入点未找到，请手工登记')
        process.exit(1)
      }
      indexText = indexText.replace(
        kunmingLine,
        `${kunmingLine}  { id: '${region}', label: '${escape(spec.regionLabel)}', routes: nationalRoutesOf('${region}') },\n`,
      )
      writeFileSync(indexFile, indexText, 'utf8')
      say('✔ index.ts 注册表已登记')
    }
    // 生成脚本 REGION_META
    const genFile = resolve(ROOT, 'scripts/generate-curated-routes.mjs')
    let genText = readFileSync(genFile, 'utf8')
    if (!genText.includes(`  ${region}: {`)) {
      const kunmingMeta = `  kunming: { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' },\n`
      genText = genText.replace(kunmingMeta, `${kunmingMeta}  ${region}: { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' },\n`)
      writeFileSync(genFile, genText, 'utf8')
      say('✔ REGION_META 已登记（生成脚本可重算该地区）')
    }
  }

  writeFileSync(testFile, testText, 'utf8')
  say('✔ 测试文件已更新')
}

writeFileSync(resolve(outDir, 'report.txt'), log.join('\n'), 'utf8')
say('')
say(`完成。下一步（${DRY ? 'dry 通过后正式入库并' : ''}人工收尾）：`)
say('  1. 打开预览审核线形：' + resolve(outDir, 'preview.html'))
say('  2. npx tsc -b && npx vitest run tests/features/curatedRoutes/ tests/features/routes/routesMapPage.test.tsx')
say('  3. 确认描述/来源文案，版本号 + changelog + 提交')
