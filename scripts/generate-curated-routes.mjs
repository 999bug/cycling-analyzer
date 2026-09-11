/**
 * 精选路线几何生成器（一次性工具，数据更新时手动运行）。
 *
 * 两种选路模式：
 * - dijkstra（默认）：按起终点锚点（可含中间途经点 waypoints，多段串联）在
 *   OSM 路网图上跑最短路径（排除高速/隧道/步道）
 * - named：按道路名拼接（适合环陵路等环线），共享节点串联成链
 *
 * 产出 `src/features/curatedRoutes/<region>Tracks.ts`（每地区一个文件）。
 * 与既有生成物合并：已存在的 key 保留不动，仅新增（保证已上线几何不被重算漂移）。
 *
 * 用法：
 *   1. （可选）先用 curl 把各路线的 `way["highway"](bbox);out geom;` 结果
 *      下载到 <CACHE_DIR>/<id>-all.json（代理不稳定时离线重算）
 *   2. node scripts/generate-curated-routes.mjs
 * 输出文件为生成物，人工勿改。OSM 数据 © OpenStreetMap 贡献者（ODbL）。
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 缓存目录可用环境变量覆盖；默认走 .tmp（gitignored，仓库约定临时产物必须放这里）
const CACHE_DIR = resolve(
  ROOT,
  process.env.CURATED_CACHE_DIR ?? '.tmp/curated-v2/tmp-overpass',
)
const REPORT_DIR = resolve(ROOT, '.tmp/curated-v2')

/** 地区 → 输出文件与导出名（二期新增地区在这里登记；全国新地区共用 nationalTracks.ts，按序合并） */
export const REGION_META = {
  beijing: { file: 'src/features/curatedRoutes/beijingTracks.ts', exportName: 'BEIJING_TRACKS' },
  xian: { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' },
  hangzhou: { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' },
  taizhou: { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' },
  shenzhen: { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' },
  chengdu: { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' },
  kunming: { file: 'src/features/curatedRoutes/nationalTracks.ts', exportName: 'NATIONAL_TRACKS' },
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

/**
 * 路线配置：
 * - region：输出归属地区
 * - bbox = [南, 西, 北, 东]（须覆盖完整路径）
 * - mode：dijkstra（默认）| named
 * - dijkstra 模式：anchors = 起点、途经点…、终点（≥2 个，逐段最短路径后串联）
 * - named 模式：names = 参与拼接的道路名
 */
const ROUTES = [
  {
    id: 'miaofeng',
    region: 'beijing',
    bbox: [39.9, 115.95, 40.05, 116.15],
    anchors: [
      [39.9883, 116.0482],
      [40.055, 116.0289],
    ],
  },
  {
    id: 'tanwang',
    region: 'beijing',
    bbox: [39.85, 115.9, 40.0, 116.12],
    anchors: [
      [39.889, 116.054],
      [39.978, 115.987],
    ],
  },
  {
    id: 'jietai',
    region: 'beijing',
    bbox: [39.865, 116.07, 39.892, 116.098],
    anchors: [
      [39.8831, 116.0726],
      [39.872, 116.0797],
    ],
  },
  // ---- 二期北京新增（锚点均经 OSM node/way 探针反查，见 .tmp/curated-v2/probe-report.txt）----
  {
    id: 'hjl',
    bbox: [39.61, 115.55, 39.77, 115.66],
    anchors: [
      [39.6454, 115.5885],
      [39.7376, 115.6242],
    ],
  },
  {
    id: 'hsl',
    bbox: [40.18, 116.13, 40.34, 116.32],
    // 环十三陵全龄友好线：昌平西关环岛→昭陵→泰陵→献陵→长陵→定陵道口→回西关环岛
    anchors: [
      [40.222, 116.2077],
      [40.2884, 116.2147],
      [40.3209, 116.2175],
      [40.3029, 116.2358],
      [40.2967, 116.2409],
      [40.2875, 116.2362],
      [40.222, 116.2077],
    ],
  },
  {
    id: 'jzs',
    bbox: [40.28, 116.2, 40.41, 116.28],
    anchors: [
      [40.2967, 116.2409],
      [40.3921, 116.2547],
    ],
  },
  {
    id: 'sh',
    bbox: [40.35, 116.3, 40.55, 116.43],
    anchors: [
      [40.3618, 116.3689],
      [40.5299, 116.407],
    ],
  },
  {
    id: 'hsl2',
    // 环陵进阶线（官方规程 55.4km 线走向）：西关环岛→长陵→泰陵→康陵→泰陵园→昭陵→回西关环岛。
    // 东侧德陵段 OSM 路网断链，产出为环线核心段（数据侧标 geometryScope core）
    bbox: [40.18, 116.13, 40.34, 116.32],
    anchors: [
      [40.222, 116.2077],
      [40.2967, 116.2409],
      [40.3209, 116.2175],
      [40.3168, 116.2062],
      [40.2701, 116.2115],
      [40.2884, 116.2147],
      [40.222, 116.2077],
    ],
  },
  {
    id: 'bll',
    bbox: [40.55, 116.08, 40.71, 116.36],
    anchors: [
      [40.5767, 116.1102],
      [40.6922, 116.3407],
    ],
  },
  {
    id: 'ms',
    // 蟒山核心爬坡段：山脚路口 → 蟒山森林公园大门（115km 为往返全程社区口径，core）
    // 爬坡道在 OSM 与环湖路不直连（仅南向接入），勿改回「大坝→水库东路→公园」组合
    bbox: [40.23, 116.24, 40.31, 116.32],
    anchors: [
      [40.2295, 116.3013],
      [40.2668, 116.2872],
    ],
  },
  {
    id: 'hhc',
    bbox: [40.35, 116.32, 40.44, 116.38],
    anchors: [
      [40.3618, 116.3689],
      [40.4158, 116.339],
    ],
  },
  {
    id: 'yxh',
    mode: 'named',
    names: ['雁栖湖路'],
    bbox: [40.38, 116.63, 40.42, 116.7],
  },
  {
    id: 'gyk',
    bbox: [40.12, 115.97, 40.19, 116.06],
    anchors: [
      [40.1811, 116.0574],
      [40.1341, 115.9904],
    ],
  },
  {
    id: 'dc',
    bbox: [40.02, 115.84, 40.13, 115.88],
    anchors: [
      [40.0379, 115.8711],
      [40.1187, 115.862],
    ],
  },
  {
    id: 'cby',
    bbox: [40.21, 116.33, 40.35, 116.42],
    anchors: [
      [40.2233, 116.4094],
      [40.3387, 116.3429],
    ],
  },
  {
    id: 'yts',
    bbox: [40.05, 116.09, 40.08, 116.12],
    anchors: [
      [40.0632, 116.114],
      [40.0668, 116.0993],
    ],
  },
  {
    id: 'cf',
    allowTrack: true,
    bbox: [39.98, 115.97, 40.08, 116.05],
    // 禅房爬坡：上苇甸北口→禅房村（社区坡度表口径 8.3km/349m）
    anchors: [
      [40.0323, 115.9864],
      [40.0754, 115.9958],
    ],
  },
  {
    id: 'hcl',
    bbox: [39.93, 116.1, 39.99, 116.19],
    anchors: [
      [39.9588, 116.1374],
      [39.971, 116.1687],
    ],
  },
  {
    id: 'dfh',
    bbox: [39.99, 115.92, 40.02, 116.0],
    // 过岭隧道在 OSM 中为下安路隧道（东方红隧道），是 G109 唯一通道，须放行
    allowTunnelNames: ['下安路'],
    anchors: [
      [40.0056, 115.9362],
      [40.0068, 115.9905],
    ],
  },
  {
    id: 'sb',
    allowTrack: true,
    bbox: [40.34, 116.58, 40.47, 116.67],
    // 山吧爬坡：官地以北至莲花池顶路段 OSM 未收录，先产出雁栖→官地核心段
    anchors: [
      [40.3577, 116.6529],
      [40.4274, 116.6292],
    ],
  },
  {
    id: 'fxl',
    region: 'xian',
    // 秦岭分水岭：沣峪口转盘 → 长江黄河分水岭垭口（G210/满防线在 OSM 为 trunk + 松树嘴隧道，须放行）
    allowTrunk: true,
    allowTunnelNames: ['松树嘴隧道'],
    bbox: [33.81, 108.74, 34.09, 108.88],
    anchors: [
      [34.0354, 108.8092],
      [33.8381, 108.8033],
    ],
  },
  {
    id: 'lj',
    region: 'hangzhou',
    // 龙井北坡：龙井路口（洪春桥）→ 龙井村（龙井路北段爬坡）
    bbox: [30.21, 120.09, 30.27, 120.17],
    anchors: [
      [30.2495, 120.1178],
      [30.231, 120.1155],
    ],
  },
  {
    id: 'kcs',
    region: 'taizhou',
    // 括苍山：屿洋线尤溪镇 → 临海/仙居交界山顶方向（风电公路爬坡）
    bbox: [28.62, 120.88, 28.9, 121.05],
    anchors: [
      [28.6361, 121.0127],
      [28.7043, 120.9184],
    ],
  },
  {
    id: 'wts',
    region: 'shenzhen',
    // 梧桐山：梧桐山北路（大望 → 好汉坡底，野途 6.28km/533m 口径）
    bbox: [22.55, 114.13, 22.62, 114.22],
    anchors: [
      [22.5925, 114.1909],
      [22.5757, 114.2032],
    ],
  },
  {
    id: 'lqs',
    region: 'chengdu',
    // 龙泉山 A 面：龙泉驿城区 → 山泉镇（桃花故里），G318/沪聂线为 trunk 须放行
    allowTrunk: true,
    bbox: [30.5, 104.25, 30.62, 104.38],
    anchors: [
      [30.5552, 104.2796],
      [30.555, 104.3129],
    ],
  },
  {
    id: 'mmq',
    region: 'kunming',
    // 西山猫猫箐：碧鸡关村 → 猫猫箐（西山前山公路盘山段）
    bbox: [24.93, 102.58, 25.02, 102.7],
    anchors: [
      [24.9768, 102.6248],
      [24.9537, 102.6381],
    ],
  },
]

/** 可骑行道路类型（排除步道/高速；隧道在下方按 tag 排除） */
export const RIDABLE = new Set([
  'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'trunk',
])
/** 骑行不可入的道路类型 */
export const EXCLUDED = new Set(['motorway', 'motorway_link', 'trunk_link', 'footway', 'path', 'steps', 'track', 'construction'])

/** 拉取一个 bbox 的全部道路方式（镜像重试由调用方负责；此处走主站） */
export async function fetchWaysMain(bbox) {
  const q = `[out:json][timeout:90];way["highway"](${bbox.join(',')});out geom;`
  const resp = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ data: q }).toString(),
  })
  if (!resp.ok) {
    throw new Error(`Overpass ${resp.status}`)
  }
  const json = await resp.json()
  return (json.elements ?? []).filter((el) => el.type === 'way')
}

/** 读取缓存或拉取路网 */
export async function loadWays(route) {
  const cacheFile = resolve(CACHE_DIR, `${route.id}-all.json`)
  if (existsSync(cacheFile)) {
    const ways = JSON.parse(readFileSync(cacheFile, 'utf8')).elements.filter((el) => el.type === 'way')
    return { ways, fromCache: true }
  }
  const ways = await fetchWaysMain(route.bbox)
  return { ways, fromCache: false }
}

/** 两点近似距离（米） */
export function distM(a, b) {
  const cosLat = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  const dLat = (a[0] - b[0]) * 110540
  const dLng = (a[1] - b[1]) * 111320 * cosLat
  return Math.hypot(dLat, dLng)
}

/** Douglas-Peucker 抽稀 */
export function simplify(points, toleranceMeters) {
  if (points.length <= 2) return points
  const cosLat = Math.cos(((points[0][0] + points[points.length - 1][0]) / 2) * Math.PI / 180)
  const toXY = ([lat, lng]) => [lng * 111320 * cosLat, lat * 110540]
  const sq = (v) => v * v
  const segDistSq = (p, a, b) => {
    const [px, py] = toXY(p)
    const [ax, ay] = toXY(a)
    const [bx, by] = toXY(b)
    const dx = bx - ax
    const dy = by - ay
    const lenSq = sq(dx) + sq(dy)
    if (lenSq === 0) return sq(px - ax) + sq(py - ay)
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
    return sq(px - ax - t * dx) + sq(py - ay - t * dy)
  }
  const keep = new Array(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()
    let maxSq = 0
    let maxIdx = -1
    for (let i = lo + 1; i < hi; i += 1) {
      const d = segDistSq(points[i], points[lo], points[hi])
      if (d > maxSq) {
        maxSq = d
        maxIdx = i
      }
    }
    if (maxIdx > 0 && maxSq > sq(toleranceMeters)) {
      keep[maxIdx] = true
      stack.push([lo, maxIdx], [maxIdx, hi])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** 折线长度（米） */
export function lineLength(line) {
  let sum = 0
  for (let i = 1; i < line.length; i += 1) sum += distM(line[i - 1], line[i])
  return sum
}

/** 构建骑行路网图（节点邻接表 + 坐标表），dijkstra/named 两模式共用。
 * opts.allowTunnelNames：允许骑行的隧道名白名单（如 G109 东方红隧道段在 OSM 中名为下安路隧道）
 * opts.allowTrack：放行 track（部分实际铺装的乡道/景区路在 OSM 中被标为 track）
 * opts.allowTrunk：放行 trunk（如 G210 满防线/G318 沪聂线在 OSM 中为 trunk，实为干线铺装公路） */
export function buildGraph(ways, opts = {}) {
  const nodeCoord = new Map()
  const adj = new Map()
  const addEdge = (a, b, w) => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a).push([b, w])
    adj.get(b).push([a, w])
  }
  for (const way of ways) {
    if (!way.nodes || !way.geometry) continue
    const hw = way.tags?.highway
    if (hw !== 'track' || !opts.allowTrack) {
      if (hw !== 'trunk' || !opts.allowTrunk) {
        if (!hw || EXCLUDED.has(hw) || !RIDABLE.has(hw)) continue
      }
    }
    if (way.tags?.tunnel === 'yes' && !(opts.allowTunnelNames?.has(way.tags?.name ?? ''))) continue
    // 防火道等明确禁行
    if ((way.tags?.name ?? '').includes('禁止')) continue
    const weightFactor = hw === 'service' ? 2 : 1
    for (let i = 1; i < way.nodes.length; i += 1) {
      const a = way.nodes[i - 1]
      const b = way.nodes[i]
      nodeCoord.set(a, [way.geometry[i - 1].lat, way.geometry[i - 1].lon])
      nodeCoord.set(b, [way.geometry[i].lat, way.geometry[i].lon])
      addEdge(a, b, distM(nodeCoord.get(a), nodeCoord.get(b)) * weightFactor)
    }
  }
  return { nodeCoord, adj }
}

/** 图上两点最短路径（节点 ID 序列），不可达返回 null */
export function graphShortestPath(nodeCoord, adj, start, end) {
  const dist = new Map([[start, 0]])
  const prev = new Map()
  const visited = new Set()
  // 简易优先队列（数据规模小，数组扫描足够）
  for (;;) {
    let cur = -1
    let curD = Infinity
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < curD) {
        cur = id
        curD = d
      }
    }
    if (cur < 0 || cur === end) break
    visited.add(cur)
    for (const [next, w] of adj.get(cur) ?? []) {
      if (visited.has(next)) continue
      const nd = curD + w
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd)
        prev.set(next, cur)
      }
    }
  }
  if (!dist.has(end)) return null
  const path = []
  for (let at = end; at !== undefined; at = prev.get(at)) {
    path.unshift(at)
  }
  return path
}

/** 锚点吸附最近路网节点（半径内），失败返回 -1 */
export function snapNode(nodeCoord, anchor, radiusM = 800) {
  let best = -1
  let bestD = Infinity
  for (const [id, coord] of nodeCoord) {
    const d = distM(coord, anchor)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return bestD <= radiusM ? best : -1
}

/**
 * dijkstra 模式：anchors 逐段最短路径并串联成完整折线。
 * 任一段不可达返回 null。
 */
function shortestPath(ways, anchors, route) {
  const { nodeCoord, adj } = buildGraph(ways, {
    allowTunnelNames: route?.allowTunnelNames ? new Set(route.allowTunnelNames) : undefined,
    allowTrack: route?.allowTrack === true,
    allowTrunk: route?.allowTrunk === true,
  })
  const nodeIds = anchors.map((a) => snapNode(nodeCoord, a))
  if (nodeIds.some((id) => id < 0)) return null
  const coords = []
  for (let i = 1; i < nodeIds.length; i += 1) {
    const leg = graphShortestPath(nodeCoord, adj, nodeIds[i - 1], nodeIds[i])
    if (leg === null) return null
    for (const id of leg) {
      const coord = nodeCoord.get(id)
      // 串联点去重（相邻段共享端点）
      const last = coords[coords.length - 1]
      if (!last || last[0] !== coord[0] || last[1] !== coord[1]) {
        coords.push(coord)
      }
    }
  }
  return coords
}

/**
 * named 模式：按道路名筛选 ways，共享节点串联成有序链（适合环线）。
 * 返回若干条折线（多链时每链一段）。
 */
function namedChains(ways, names) {
  const nameSet = new Set(names)
  const pool = ways.filter((w) => nameSet.has(w.tags?.name ?? '') && w.nodes && w.geometry)
  const chains = []
  const used = new Set()
  for (const way of pool) {
    if (used.has(way.id)) continue
    // 从该 way 向两头延伸：找共享端节点的下一条
    let head = [...way.nodes]
    used.add(way.id)
    for (;;) {
      const tail = head[head.length - 1]
      const next = pool.find(
        (w) => !used.has(w.id) && (w.nodes[0] === tail || w.nodes[w.nodes.length - 1] === tail),
      )
      if (!next) break
      used.add(next.id)
      const pts = next.nodes[0] === tail ? [...next.nodes] : [...next.nodes].reverse()
      head = [...head, ...pts.slice(1)]
    }
    for (;;) {
      const top = head[0]
      const prevWay = pool.find(
        (w) => !used.has(w.id) && (w.nodes[0] === top || w.nodes[w.nodes.length - 1] === top),
      )
      if (!prevWay) break
      used.add(prevWay.id)
      const pts = prevWay.nodes[prevWay.nodes.length - 1] === top
        ? [...prevWay.nodes]
        : [...prevWay.nodes].reverse()
      head = [...pts.slice(0, -1), ...head]
    }
    // 节点 ID → 坐标（从 ways 的 geometry 取）
    const coordById = new Map()
    for (const w of pool) {
      w.nodes.forEach((id, i) => coordById.set(id, [w.geometry[i].lat, w.geometry[i].lon]))
    }
    chains.push(head.map((id) => coordById.get(id)).filter(Boolean))
  }
  return chains
}

/** 解析既有生成文件里的 JSON 数据（合并用），无文件或解析失败返回空 */
export function readExistingOutput(outFile, exportName) {
  if (!existsSync(outFile)) return {}
  try {
    const text = readFileSync(outFile, 'utf8')
    const marker = `${exportName}: Record<string, [number, number][][]> = `
    const idx = text.indexOf(marker)
    if (idx < 0) return {}
    return JSON.parse(text.slice(idx + marker.length))
  } catch {
    return {}
  }
}

/** 生成 tracks 数据文件内容（curate-route.mjs 复用同一模板，保证两脚本产出一致） */
export function renderTracksFile(exportName, output) {
  const tsBody = JSON.stringify(output, null, 0)
  return `/**
 * 精选路线几何数据（WGS-84，[纬度, 经度][] 数组，每条路线可为多段折线）。
 *
 * 本文件为生成物：由 scripts/generate-curated-routes.mjs 从 OSM 路网拉取、
 * Dijkstra 选路 + 抽稀产出，勿手改；数据 © OpenStreetMap 贡献者（ODbL）。
 * 渲染时由调用方经 projectPoint 投影到底图坐标系。
 */
export const ${exportName}: Record<string, [number, number][][]> = ${tsBody}
`
}

// ---- 主流程（仅直接运行本文件时执行；被 curate-route.mjs import 时跳过）----

async function main() {
  // 按地区分组处理（未显式标注 region 的视为北京）
  const byRegion = new Map()
  for (const route of ROUTES) {
    const region = route.region ?? 'beijing'
    if (!byRegion.has(region)) byRegion.set(region, [])
    byRegion.get(region).push(route)
  }

  mkdirSync(REPORT_DIR, { recursive: true })

  for (const [region, routes] of byRegion) {
    const meta = REGION_META[region]
    if (!meta) {
      console.error(`unknown region: ${region}（先在 REGION_META 登记）`)
      process.exit(1)
    }
    const outFile = resolve(ROOT, meta.file)
    const report = []
    const output = readExistingOutput(outFile, meta.exportName)
    let added = 0
    let skippedExisting = 0

    for (const route of routes) {
      // CURATED_FORCE_IDS=id1,id2 强制重算指定路线（覆盖既有输出）
      const force = new Set((process.env.CURATED_FORCE_IDS ?? '').split(',').filter(Boolean))
      if (output[route.id] !== undefined && !force.has(route.id)) {
        skippedExisting += 1
        continue
      }
      let ways
      try {
        const loaded = await loadWays(route)
        ways = loaded.ways
        report.push(`${route.id}: ${loaded.fromCache ? 'cache' : 'fetched'} → ${ways.length} ways`)
      } catch (error) {
        report.push(`${route.id}: FETCH FAILED — ${error.message}`)
        continue
      }
      let lines
      if (route.mode === 'named') {
        lines = namedChains(ways, route.names)
      } else {
        const path = shortestPath(ways, route.anchors, route)
        lines = path === null ? [] : [path]
      }
      if (lines.length === 0) {
        report.push(`${route.id}: NO PATH`)
        continue
      }
      const simplified = lines.map((line) => simplify(line, 12)).filter((line) => line.length >= 2)
      const totalKm = simplified.reduce((sum, line) => sum + lineLength(line), 0) / 1000
      report.push(
        `${route.id}: chains=${simplified.length} total=${totalKm.toFixed(2)}km pts=${simplified.reduce((s, l) => s + l.length, 0)}`,
      )
      output[route.id] = simplified
      added += 1
    }

    writeFileSync(outFile, renderTracksFile(meta.exportName, output), 'utf8')
    writeFileSync(resolve(REPORT_DIR, `report-${region}.txt`), report.join('\n'), 'utf8')
    console.log(`${region}: +${added} generated, ${skippedExisting} kept from existing → ${meta.file}`)
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  await main()
}
