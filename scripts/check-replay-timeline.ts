/**
 * 回放时间轴真实数据回归检查（本地工具，不进 CI）。
 *
 * 用途：改动回放时间轴 / 暂停判定 / 移动时长口径后，一条命令在**全量真实轨迹**上
 * 复算出回放时长与光标位移，验证两条不变量与跳变指标没有回归。
 *
 * 数据目录默认 `private-fixtures/`（gitignored 的用户真实数据，**严禁提交或写入快照**）。
 * 支持 `.fit` / `.fit.gz` / `.gpx.gz`；GPX 需要 DOMParser，脚本在纯 Node 下借 jsdom 补上。
 *
 * 用法：
 *   npm run check:replay                              # 默认 private-fixtures
 *   npm run check:replay -- <数据目录>                # 指定目录
 *   npm run check:replay -- <数据目录> --verbose      # 逐份列出指标
 *
 * 判定口径（与采样步长无关，逐段时间轴分析）：
 * - 硬失败（退出码 1）：① 回放时长不在 [运动时长, 总耗时] 内；② 单段等效光标速度
 *   超过 JUMP_SPEED_FAIL_MPS（肉眼可见的瞬移）；
 * - 提示（不影响退出码）：单段速度超过 JUMP_SPEED_WARN_MPS、时长与活动计时偏差 > 2%。
 */
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { cleanTrackDrift } from '@/features/activity/trackCleanup'
import { movingDurationOf } from '@/features/activity/movingTime'
import { gunzipBytes, shouldGunzip } from '@/features/import/gzip'
import { parseFitBytes } from '@/fit/worker/parseTask'
import { parseGpxActivity } from '@/gpx/gpxParser'
import { buildMovingTimeline, MAX_CURSOR_SPEED_MPS } from '@/map/replayCore'
import { simplifyRoute } from '@/map/simplify'
import { haversineMeters } from '@/charts/timeline'
import type { Activity, RoutePoint } from '@/types/activity'

/** 轨迹抽稀阈值（米）：与详情页 SIMPLIFY_TOLERANCE_METERS 保持一致（回放消费的是同一份抽稀点） */
const SIMPLIFY_TOLERANCE_METERS = 5

/** 单段等效光标速度上限（m/s）：超过即判定为肉眼可见的瞬移（硬失败） */
const JUMP_SPEED_FAIL_MPS = 100

/** 单段等效光标速度提示阈值（m/s）：超过仅提示（GPS 飞点级数据噪声） */
const JUMP_SPEED_WARN_MPS = 40

/** 时钟增量为 0 时仍算「动了」的位移阈值（米） */
const INSTANT_JUMP_METERS = 10

/** 回放时长与活动计时时长的偏差提示阈值（比例） */
const DURATION_DRIFT_WARN_RATIO = 0.02

/** 单份轨迹的回放时间轴指标 */
interface TrackReport {
  /** 相对数据目录的路径 */
  name: string

  /** 原始逐点记录数 */
  recordCount: number

  /** 抽稀后的展示点数 */
  displayCount: number

  /** 运动时长（密集记录判定，按展示点时间范围裁剪，秒） */
  movingSeconds: number

  /** 回放时长（时间轴跨度，秒） */
  replaySeconds: number

  /** 活动计时时长（秒） */
  timerSeconds: number

  /** 活动总耗时（秒） */
  elapsedSeconds: number

  /** 最大单段等效光标速度（m/s） */
  maxSpeed: number

  /** 出现最大速度那一段的位移（米） */
  maxSpeedHopMeters: number

  /** 最大单段位移（米） */
  maxHopMeters: number

  /** 瞬时跳变段数（时钟增量为 0 且位移超过阈值） */
  instantJumps: number

  /** 硬失败原因（空数组 = 通过） */
  failures: string[]

  /** 提示项 */
  warnings: string[]
}

/** 扫描目录下所有轨迹文件（递归） */
async function collectTracks(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (/\.(fit|gpx)(\.gz)?$/i.test(entry.name)) {
        found.push(full)
      }
    }
  }
  await walk(root)
  return found.sort()
}

/**
 * 纯 Node 下为 GPX 解析补 DOMParser（浏览器端本就存在）。
 *
 * 用 createRequire 而非 import：jsdom 未附类型声明（@types/jsdom 未安装），
 * 静态 import 会触发 TS7016；这里只需要一个极窄的接口，转成 any 后自行断言即可。
 */
async function ensureDomParser(): Promise<boolean> {
  if (typeof (globalThis as { DOMParser?: unknown }).DOMParser !== 'undefined') {
    return true
  }
  try {
    const require_ = createRequire(import.meta.url)
    const { JSDOM } = require_('jsdom') as {
      JSDOM: new () => { window: { DOMParser: unknown } }
    }
    ;(globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM().window.DOMParser
    return true
  } catch {
    return false
  }
}

/** 解析单份轨迹文件；失败返回 undefined（HTTP/gzip 解压、格式识别与浏览器端同一套代码） */
async function loadActivity(file: string, domParserReady: boolean): Promise<Activity | undefined> {
  if (/\.gpx(\.gz)?$/i.test(file) && !domParserReady) {
    return undefined
  }
  const buf = await readFile(file)
  let bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  if (shouldGunzip(file, bytes)) {
    bytes = gunzipBytes(bytes)
  }
  const input = { bytes, fileName: file.split(/[\\/]/).pop() ?? file, fingerprint: 'check' }
  return /\.gpx(\.gz)?$/i.test(file) ? parseGpxActivity(input) : parseFitBytes(input)
}

/** 复算单份轨迹的回放时间轴指标（与 TrackReplay 的调用链一致） */
function inspect(name: string, activity: Activity, cleaned: ReturnType<typeof cleanTrackDrift>['cleaned']): TrackReport | undefined {
  const displayPoints: RoutePoint[] = simplifyRoute(cleaned, SIMPLIFY_TOLERANCE_METERS)
  if (displayPoints.length < 2) {
    return undefined
  }
  const timeline = buildMovingTimeline(displayPoints, cleaned)
  const first = displayPoints[0]!.timestamp
  const last = displayPoints[displayPoints.length - 1]!.timestamp
  // 运动时长的参照值：密集记录判定结果，裁剪到展示点时间范围内（展示点缺坐标时范围会更窄）
  const movingSeconds = movingDurationOf(cleaned.filter((r) => r.timestamp >= first && r.timestamp <= last))
  const replaySeconds = timeline[timeline.length - 1]!.timestamp - timeline[0]!.timestamp
  const timerSeconds = activity.duration
  const elapsedSeconds = activity.elapsedTime

  let maxSpeed = 0
  let maxSpeedHopMeters = 0
  let maxHopMeters = 0
  let instantJumps = 0
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1]!
    const curr = timeline[i]!
    const disp = haversineMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude)
    const dtClock = curr.timestamp - prev.timestamp
    if (dtClock > 0) {
      const speed = disp / dtClock
      if (speed > maxSpeed) {
        maxSpeed = speed
        maxSpeedHopMeters = disp
      }
    } else if (disp > INSTANT_JUMP_METERS) {
      instantJumps++
    }
    if (disp > maxHopMeters) {
      maxHopMeters = disp
    }
  }

  const failures: string[] = []
  const warnings: string[] = []
  if (replaySeconds < movingSeconds - 1) {
    failures.push(`回放时长 ${replaySeconds}s 小于运动时长 ${movingSeconds}s（暂停折叠越界）`)
  }
  if (elapsedSeconds > 0 && replaySeconds > elapsedSeconds + 1) {
    failures.push(`回放时长 ${replaySeconds}s 超过总耗时 ${elapsedSeconds}s（补时越界）`)
  }
  if (instantJumps > 0) {
    failures.push(`存在 ${instantJumps} 段瞬时跳变（时钟增量为 0 且位移 >${INSTANT_JUMP_METERS}m）`)
  }
  if (maxSpeed > JUMP_SPEED_FAIL_MPS) {
    failures.push(`最大单段等效速度 ${maxSpeed.toFixed(0)}m/s（该段位移 ${maxSpeedHopMeters.toFixed(0)}m），超过 ${JUMP_SPEED_FAIL_MPS}m/s`)
  } else if (maxSpeed > JUMP_SPEED_WARN_MPS) {
    warnings.push(`最大单段等效速度 ${maxSpeed.toFixed(0)}m/s（该段位移 ${maxSpeedHopMeters.toFixed(0)}m，GPS 飞点级数据噪声）`)
  }
  if (timerSeconds > 0) {
    const drift = Math.abs(replaySeconds - timerSeconds) / timerSeconds
    if (drift > DURATION_DRIFT_WARN_RATIO) {
      warnings.push(`回放时长 ${replaySeconds}s 与活动计时 ${timerSeconds}s 偏差 ${(drift * 100).toFixed(1)}%`)
    }
  }
  return {
    name,
    recordCount: cleaned.length,
    displayCount: displayPoints.length,
    movingSeconds,
    replaySeconds,
    timerSeconds,
    elapsedSeconds,
    maxSpeed,
    maxSpeedHopMeters,
    maxHopMeters,
    instantJumps,
    failures,
    warnings,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const dirArg = args.find((arg) => !arg.startsWith('--')) ?? 'private-fixtures'
  const root = resolve(dirArg)

  const domParserReady = await ensureDomParser()
  if (!domParserReady) {
    console.log('提示：当前环境无法启用 DOMParser，GPX 轨迹将被跳过\n')
  }
  const files = await collectTracks(root)
  if (files.length === 0) {
    console.error(`No track files found under ${root}`)
    process.exit(1)
  }
  console.log(`检查 ${files.length} 份轨迹（${root}）\n`)

  const reports: TrackReport[] = []
  const parseFailures: string[] = []
  let skippedNoCoords = 0
  for (const file of files) {
    const name = relative(root, file)
    let activity: Activity | undefined
    try {
      activity = await loadActivity(file, domParserReady)
    } catch (error) {
      parseFailures.push(`${name}: ${(error as Error).message}`)
      continue
    }
    if (activity === undefined) {
      parseFailures.push(`${name}: 无法解析（或环境缺少 DOMParser）`)
      continue
    }
    const cleaned = cleanTrackDrift(activity.records ?? []).cleaned
    const report = inspect(name, activity, cleaned)
    if (report === undefined) {
      skippedNoCoords++
      continue
    }
    reports.push(report)
    if (verbose) {
      console.log(
        `${report.name}\n  记录 ${report.recordCount} 抽稀 ${report.displayCount} | ` +
        `运动 ${report.movingSeconds}s 回放 ${report.replaySeconds}s 计时 ${report.timerSeconds}s 总耗时 ${report.elapsedSeconds}s | ` +
        `最大单段 ${report.maxSpeed.toFixed(0)}m/s（该段 ${report.maxSpeedHopMeters.toFixed(0)}m）`,
      )
    }
  }

  const failed = reports.filter((report) => report.failures.length > 0)
  const warned = reports.filter((report) => report.failures.length === 0 && report.warnings.length > 0)
  const worstSpeed = reports.reduce((acc, report) => Math.max(acc, report.maxSpeed), 0)
  const worstHop = reports.reduce((acc, report) => Math.max(acc, report.maxHopMeters), 0)

  console.log(`\n通过 ${reports.length - failed.length}/${reports.length} 份（跳过无坐标 ${skippedNoCoords} 份，解析失败 ${parseFailures.length} 份）`)
  console.log(
    `补时目标速度 ${MAX_CURSOR_SPEED_MPS} m/s；实测最大单段等效速度 ${worstSpeed.toFixed(1)} m/s（${(worstSpeed * 3.6).toFixed(0)} km/h）` +
    `——高于目标值说明该段真实间隔太短、补时已用满（通常是 1 秒内的 GPS 飞点）`,
  )
  console.log(`最大单段位移 ${worstHop.toFixed(1)} m（记录断档段，按真实间隔补时后平滑滑过）`)

  if (warned.length > 0) {
    console.log(`\n提示（${warned.length} 份）`)
    for (const report of warned) {
      console.log(`· ${report.name}\n  ${report.warnings.join('；')}`)
    }
  }
  if (parseFailures.length > 0) {
    console.log(`\n解析失败（${parseFailures.length} 份）`)
    for (const line of parseFailures) {
      console.log(`· ${line}`)
    }
  }
  if (failed.length > 0) {
    console.log(`\n硬失败（${failed.length} 份）`)
    for (const report of failed) {
      console.log(`· ${report.name}\n  ${report.failures.join('；')}`)
    }
    process.exit(1)
  }
  console.log('\n全部通过：运动时长 ≤ 回放时长 ≤ 总耗时，且无可见瞬移')
}

main().catch((error) => {
  console.error('Replay timeline check failed:', error)
  process.exit(1)
})
