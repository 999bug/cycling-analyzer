/**
 * 精选路线几何生成器（一次性工具，数据更新时手动运行）。
 *
 * 从 Overpass API 拉取 OSM 路网（WGS-84），按起终点锚点在路网图上跑 Dijkstra
 * 最短路径（排除高速/隧道），Douglas-Peucker 抽稀后产出
 * `src/features/curatedRoutes/beijingTracks.ts`。
 *
 * 用法：
 *   1. （可选）先用 curl 把各路线的 `way["highway"](bbox);out geom;` 结果
 *      下载到 tmp-overpass/<id>-all.json（代理不稳定时离线重算）
 *   2. node scripts/generate-curated-routes.mjs
 * 输出文件为生成物，人工勿改。OSM 数据 © OpenStreetMap 贡献者（ODbL）。
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_FILE = resolve(ROOT, 'src/features/curatedRoutes/beijingTracks.ts')
const REPORT_FILE = resolve(ROOT, 'tmp-curated-routes-report.txt')
const CACHE_DIR = resolve(ROOT, 'tmp-overpass')

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

/**
 * 路线配置：bbox = [南, 西, 北, 东]（须覆盖完整路径）；
 * startAnchor / endAnchor 近似起终点坐标（吸附到最近路网节点）。
 */
const ROUTES = [
  {
    id: 'miaofeng',
    bbox: [39.9, 115.95, 40.05, 116.15],
    startAnchor: [39.9883, 116.0482],
    endAnchor: [40.055, 116.0289],
  },
  {
    id: 'tanwang',
    bbox: [39.85, 115.9, 40.0, 116.12],
    startAnchor: [39.889, 116.054],
    endAnchor: [39.978, 115.987],
  },
  {
    id: 'jietai',
    bbox: [39.865, 116.07, 39.892, 116.098],
    startAnchor: [39.8831, 116.0726],
    endAnchor: [39.872, 116.0797],
  },
]

/** 可骑行道路类型（排除步道/高速；隧道在下方按 tag 排除） */
const RIDABLE = new Set([
  'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'trunk',
])
/** 骑行不可入的道路类型 */
const EXCLUDED = new Set(['motorway', 'motorway_link', 'trunk_link', 'footway', 'path', 'steps', 'track', 'construction'])

/** 拉取一个 bbox 的全部道路方式 */
async function fetchWays(bbox) {
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

/** 两点近似距离（米） */
function distM(a, b) {
  const cosLat = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  const dLat = (a[0] - b[0]) * 110540
  const dLng = (a[1] - b[1]) * 111320 * cosLat
  return Math.hypot(dLat, dLng)
}

/** Douglas-Peucker 抽稀 */
function simplify(points, toleranceMeters) {
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
function lineLength(line) {
  let sum = 0
  for (let i = 1; i < line.length; i += 1) sum += distM(line[i - 1], line[i])
  return sum
}

/**
 * 在路网图上做 Dijkstra：锚点吸附到最近路网节点（800m 内），
 * 返回最短路径折线；不可达返回 null。
 */
function shortestPath(ways, startAnchor, endAnchor) {
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
    if (!hw || EXCLUDED.has(hw) || !RIDABLE.has(hw)) continue
    if (way.tags?.tunnel === 'yes') continue
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
  const snap = (anchor) => {
    let best = -1
    let bestD = Infinity
    for (const [id, coord] of nodeCoord) {
      const d = distM(coord, anchor)
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    return bestD <= 800 ? best : -1
  }
  const start = snap(startAnchor)
  const end = snap(endAnchor)
  if (start < 0 || end < 0) return null
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
    path.unshift(nodeCoord.get(at))
  }
  return path
}

const report = []
const output = {}

for (const route of ROUTES) {
  const cacheFile = resolve(CACHE_DIR, `${route.id}-all.json`)
  let ways
  try {
    if (existsSync(cacheFile)) {
      ways = JSON.parse(readFileSync(cacheFile, 'utf8')).elements.filter((el) => el.type === 'way')
      report.push(`${route.id}: cache → ${ways.length} ways`)
    } else {
      ways = await fetchWays(route.bbox)
      report.push(`${route.id}: fetched → ${ways.length} ways`)
    }
  } catch (error) {
    report.push(`${route.id}: FETCH FAILED — ${error.message}`)
    continue
  }
  const path = shortestPath(ways, route.startAnchor, route.endAnchor)
  if (path === null) {
    report.push(`${route.id}: NO PATH`)
    continue
  }
  const simplified = simplify(path, 12)
  report.push(
    `${route.id}: path=${(lineLength(path) / 1000).toFixed(2)}km simplified=${(lineLength(simplified) / 1000).toFixed(2)}km pts=${simplified.length}`,
  )
  output[route.id] = [simplified]
}

const tsBody = JSON.stringify(output, null, 0)
const content = `/**
 * 精选路线几何数据（WGS-84，[纬度, 经度][] 数组，每条路线可为多段折线）。
 *
 * 本文件为生成物：由 scripts/generate-curated-routes.mjs 从 OSM 路网拉取、
 * Dijkstra 选路 + 抽稀产出，勿手改；数据 © OpenStreetMap 贡献者（ODbL）。
 * 渲染时由调用方经 projectPoint 投影到底图坐标系。
 */
export const BEIJING_TRACKS: Record<string, [number, number][][]> = ${tsBody}
`
writeFileSync(OUT_FILE, content, 'utf8')
writeFileSync(REPORT_FILE, report.join('\n'), 'utf8')
