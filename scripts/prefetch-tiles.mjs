/**
 * 作者数据地图瓦片预取脚本（node scripts/prefetch-tiles.mjs）。
 *
 * 目的：高德在线瓦片加载慢，把作者骑行轨迹覆盖区域的高德瓦片预取到
 * public/author-data/tiles/{z}/{x}/{y}.png 随站点发布，访客同域直读零等待。
 *
 * 数据源：public/author-data/precomputed/tracks.json（build:author-data 产物，
 * 全部活动的抽稀轨迹）。沿轨迹逐点收集各 zoom 级瓦片坐标去重——线性覆盖
 * 远小于 bbox 矩形全量（实测 81 条轨迹 z8-15 仅 ~1700 张 ≈25MB）。
 *
 * 行为：
 * - 并发受限下载（默认 4），单张失败重试 2 次；
 * - 已存在且非空的文件跳过（断点续传，可重复执行增量补齐）；
 * - 生成 tiles-manifest.json（["z/x/y", ...] 清单，运行时查询命中才走本地路径）。
 *
 * 注意：瓦片来自高德公开服务，仅限个人低量使用；脚本有并发与总量约束，
 * 勿调大并发或用于其他区域批量抓取。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TRACKS_FILE = join(ROOT, 'public/author-data/precomputed/tracks.json')
const OUT_DIR = join(ROOT, 'public/author-data/tiles')
const MANIFEST_FILE = join(ROOT, 'public/author-data/tiles-manifest.json')

/** 预取 zoom 范围（含边界）：z8 全国概览 → z15 街区级 */
const MIN_ZOOM = 8
const MAX_ZOOM = 15

/** 同时进行的下载数（礼貌抓取，勿调大） */
const CONCURRENCY = 4

/** 单张瓦片最大重试次数（含首次） */
const MAX_ATTEMPTS = 3

/** 高德子域轮询（webrd01-04） */
const SUBDOMAINS = ['1', '2', '3', '4']

function lngToTileX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z)
}

function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180
  return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** z)
}

async function main() {
  const raw = await readFile(TRACKS_FILE, 'utf8')
  const tracksFile = JSON.parse(raw)

  // 沿轨迹收集各 zoom 级唯一瓦片 key
  const byZoom = new Map()
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
    byZoom.set(z, new Set())
  }
  for (const track of tracksFile.tracks) {
    for (const [lat, lng] of track) {
      for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
        byZoom.get(z).add(`${lngToTileX(lng, z)}/${latToTileY(lat, z)}`)
      }
    }
  }

  // 展平为任务清单
  const tasks = []
  for (const [z, set] of byZoom) {
    for (const key of set) {
      const [x, y] = key.split('/')
      tasks.push({ z, x: Number(x), y: Number(y), key })
    }
  }
  console.log(`待处理瓦片：${tasks.length} 张（z${MIN_ZOOM}-z${MAX_ZOOM}）`)

  let downloaded = 0
  let skipped = 0
  let failed = 0
  const manifestKeys = []

  async function fetchOne(task) {
    const outPath = join(OUT_DIR, `${task.z}/${task.x}/${task.y}.png`)
    if (existsSync(outPath) && statSync(outPath).size > 0) {
      skipped += 1
      return true
    }
    const subdomain = SUBDOMAINS[(task.x + task.y) % SUBDOMAINS.length]
    const url = `https://webrd0${subdomain}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${task.x}&y=${task.y}&z=${task.z}`
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length === 0) {
          throw new Error('empty body')
        }
        await mkdir(dirname(outPath), { recursive: true })
        await writeFile(outPath, buffer)
        downloaded += 1
        return true
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          console.error(`失败：${task.z}/${task.key}.png`, error.message)
          return false
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      }
    }
    return false
  }

  // 受限并发执行
  let cursor = 0
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor]
      cursor += 1
      const ok = await fetchOne(task)
      if (ok) {
        manifestKeys.push(`${task.z}/${task.key}`)
      } else {
        failed += 1
      }
      if ((downloaded + skipped) % 200 === 0) {
        console.log(`进度：${downloaded + skipped}/${tasks.length}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  // 清单排序保证 diff 稳定
  manifestKeys.sort()
  await writeFile(MANIFEST_FILE, JSON.stringify(manifestKeys), 'utf8')

  console.log(
    `完成：新增 ${downloaded}，已存在跳过 ${skipped}，失败 ${failed}。清单 ${manifestKeys.length} 条 → tiles-manifest.json`,
  )
  if (failed > 0) {
    process.exitCode = 1
  }
}

await main()
