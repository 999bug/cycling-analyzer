/**
 * 作者数据快照构建核心（CI 与本地共用，设计见 docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md）。
 *
 * 流程：递归扫描 fit 目录 → gzip 解压 → 指纹去重 → 解析标准化 → NP 计算 →
 * 摘要/逐点拆分写出 → 跨活动预计算（热力图轨迹/赛段榜/路线分组/功率纪录）。
 *
 * 设计要点：
 * - 活动 ID = 文件内容指纹（确定性）：重复构建 ID 不变，详情页深链跨部署存活
 * - 任一文件解析失败即抛错（fail-fast），由 CLI 入口转 exit 1，不静默少数据
 * - 解析完全复用 src 的浏览器侧纯函数（fflate/@garmin/fitsdk 均跨环境）
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseFitBytes } from '@/fit/worker/parseTask'
import { computeFingerprint } from '@/utils/fingerprint'
import { gunzipBytes, shouldGunzip } from '@/features/import/gzip'
import { calculateNormalizedPower } from '@/features/analysis/normalizedPower'
import {
  buildStravaTitleLookup,
  matchStravaTitle,
  parseStravaActivitiesCsv,
} from '@/features/import/stravaExport'
import { simplifyRoute } from '@/map/simplify'
import {
  buildSegmentLeaderboard,
  type SegmentActivityInput,
} from '@/features/segments/segmentMatching'
import {
  buildRouteGroups,
  extractEndpoints,
  type RouteActivityInput,
} from '@/features/routes/routeGrouping'
import { buildPowerCurve } from '@/features/analysis/powerCurve'
import {
  buildPowerRecords,
  POWER_RECORD_DURATIONS,
  type ActivityPowerCurve,
} from '@/features/records/personalRecords'
import type { Activity, ActivityRecord } from '@/types/activity'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import type { SegmentEntity } from '@/storage/db'
import {
  SNAPSHOT_VERSION,
  type ActivityRecordsFile,
  type AuthorSnapshotManifest,
  type SegmentResultsFile,
  type TracksFile,
} from '@/storage/authorData/snapshotTypes'

/** 快照构建入参 */
export interface BuildAuthorDataOptions {
  /** FIT 文件目录（递归扫描 .fit/.fit.gz） */
  fitDir: string

  /** 快照输出目录 */
  outDir: string

  /** 作者显示名（写入 manifest） */
  author: string

  /** 可选：Strava activities.csv 路径（标题还原） */
  csvPath?: string

  /** 可选：作者训练配置 JSON 路径（透传） */
  profilePath?: string

  /** 可选：作者赛段定义 JSON 路径（透传 + 预计算成绩榜） */
  segmentsPath?: string
}

/** 快照构建统计 */
export interface BuildAuthorDataStats {
  /** 扫描到的 FIT 文件数 */
  files: number

  /** 成功解析入库的活动数 */
  parsed: number

  /** 因内容指纹重复跳过的文件数 */
  duplicates: number
}

/** 热力图轨迹抽稀阈值（米）：与 HeatmapPage 本地口径一致 */
const TRACKS_SIMPLIFY_TOLERANCE_METERS = 10

/** 一条可绘制轨迹至少需要的点数（与 HeatmapPage 口径一致） */
const MIN_TRACK_POINTS = 2

/** 轨迹坐标小数位数（约 1.1m 精度，控制 tracks.json 体积） */
const TRACK_COORDINATE_DECIMALS = 5

/**
 * 构建作者数据快照。
 *
 * @param options 构建入参
 * @returns 构建统计
 * @throws 任一 FIT 文件解析失败（错误消息含文件名）
 */
export async function buildAuthorData(options: BuildAuthorDataOptions): Promise<BuildAuthorDataStats> {
  const { fitDir, outDir, author } = options
  const files = await scanFitFiles(fitDir)
  const titles = await loadTitleLookup(options.csvPath)

  const seen = new Set<string>()
  const activities: Array<{ summary: ActivitySummary; records: ActivityRecord[] }> = []
  let duplicates = 0

  for (const file of files) {
    const bytes = await readFile(join(fitDir, file.relPath))
    const raw = toArrayBuffer(bytes)
    const content = shouldGunzip(file.name, raw) ? gunzipBytes(raw) : raw
    const fingerprint = await computeFingerprint(content)
    if (seen.has(fingerprint)) {
      duplicates++
      console.warn(`Skip duplicate file (same content fingerprint): ${file.relPath}`)
      continue
    }
    seen.add(fingerprint)

    let activity: Activity
    try {
      activity = parseFitBytes({ fileName: file.name, bytes: content, fingerprint })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse author FIT file ${file.relPath}: ${reason}`)
    }
    // 确定性 ID = 内容指纹（覆盖 parseFitBytes 的随机 UUID），重建深链不变
    const normalizedPower = calculateNormalizedPower(activity.records ?? [])
    const named: Activity = {
      ...activity,
      id: fingerprint,
      fileId: fingerprint,
      name: matchStravaTitle(file.relPath, file.name, titles),
      normalizedPower,
    }
    activities.push({ summary: toSummary(named), records: toRecords(named) })
  }

  activities.sort((a, b) => b.summary.startTime.localeCompare(a.summary.startTime))

  await mkdir(join(outDir, 'records'), { recursive: true })
  await mkdir(join(outDir, 'precomputed'), { recursive: true })
  await writeJson(outDir, 'activities.json', activities.map((item) => item.summary))
  for (const item of activities) {
    const file: ActivityRecordsFile = { activityId: item.summary.id, records: item.records }
    await writeJson(outDir, `records/${item.summary.id}.json`, file)
  }

  const manifest: AuthorSnapshotManifest = {
    snapshotVersion: SNAPSHOT_VERSION,
    author,
    generatedAt: new Date().toISOString(),
    activityCount: activities.length,
  }
  await writeJson(outDir, 'manifest.json', manifest)

  await copyThroughJson(outDir, 'profile.json', options.profilePath)
  await writeSegments(outDir, options.segmentsPath, activities)
  await writePrecomputed(outDir, activities)

  return { files: files.length, parsed: activities.length, duplicates }
}

/** 扫描到的单个 FIT 文件 */
interface ScannedFitFile {
  /** 相对 fitDir 的路径（CSV 标题还原的匹配键） */
  relPath: string

  /** 纯文件名 */
  name: string
}

/**
 * 递归扫描 fit 目录下的 .fit/.fit.gz 文件（文件名排序保证处理顺序确定）。
 *
 * @param fitDir FIT 文件目录
 * @returns 文件列表（相对路径 + 纯文件名）
 */
async function scanFitFiles(fitDir: string): Promise<ScannedFitFile[]> {
  const entries = await readdir(fitDir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => {
      if (!entry.isFile()) {
        return false
      }
      const lower = entry.name.toLowerCase()
      return lower.endsWith('.fit') || lower.endsWith('.fit.gz')
    })
    .map((entry) => {
      const relPath = relative(fitDir, join(entry.parentPath, entry.name))
      return { relPath, name: entry.name }
    })
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/**
 * 加载 Strava 标题查找表（CSV 不存在时返回空表）。
 *
 * @param csvPath activities.csv 路径（可选）
 */
async function loadTitleLookup(csvPath: string | undefined): Promise<Map<string, string>> {
  if (csvPath === undefined) {
    return new Map()
  }
  try {
    const text = await readFile(csvPath, 'utf8')
    return buildStravaTitleLookup(parseStravaActivitiesCsv(text))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map()
    }
    throw error
  }
}

/**
 * 领域活动 → 摘要（字段清单与 Dexie toActivityEntity 一致，剥离 records/route）。
 *
 * @param activity 领域活动
 */
function toSummary(activity: Activity): ActivitySummary {
  return {
    id: activity.id,
    name: activity.name,
    fileId: activity.fileId,
    fileName: activity.fileName,
    fingerprint: activity.fingerprint,
    activityType: activity.activityType,
    startTime: activity.startTime,
    endTime: activity.endTime,
    duration: activity.duration,
    elapsedTime: activity.elapsedTime,
    distance: activity.distance,
    elevationGain: activity.elevationGain,
    elevationLoss: activity.elevationLoss,
    calories: activity.calories,
    avgSpeed: activity.avgSpeed,
    maxSpeed: activity.maxSpeed,
    avgHeartRate: activity.avgHeartRate,
    maxHeartRate: activity.maxHeartRate,
    avgCadence: activity.avgCadence,
    maxCadence: activity.maxCadence,
    avgPower: activity.avgPower,
    maxPower: activity.maxPower,
    normalizedPower: activity.normalizedPower,
    trainingLoad: activity.trainingLoad,
    ftp: activity.ftp,
    aerobicTrainingEffect: activity.aerobicTrainingEffect,
    anaerobicTrainingEffect: activity.anaerobicTrainingEffect,
    device: activity.device,
  }
}

/**
 * 领域活动 → 逐点记录（字段清单与 Dexie toRecordEntities 一致，grade 不落快照）。
 *
 * @param activity 领域活动
 */
function toRecords(activity: Activity): ActivityRecord[] {
  return (activity.records ?? []).map((record) => ({
    timestamp: record.timestamp,
    latitude: record.latitude,
    longitude: record.longitude,
    altitude: record.altitude,
    distance: record.distance,
    speed: record.speed,
    heartRate: record.heartRate,
    cadence: record.cadence,
    power: record.power,
    temperature: record.temperature,
  }))
}

/**
 * 可选 JSON 源文件透传到产物（不存在则跳过；内容解析失败即抛错）。
 *
 * @param outDir 输出目录
 * @param outName 产物文件名
 * @param sourcePath 源文件路径（可选）
 */
async function copyThroughJson(outDir: string, outName: string, sourcePath: string | undefined): Promise<void> {
  if (sourcePath === undefined) {
    return
  }
  try {
    const data: unknown = JSON.parse(await readFile(sourcePath, 'utf8'))
    await writeJson(outDir, outName, data)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
}

/**
 * 赛段透传（id 按下标 1 起始重排）并预计算成绩榜。
 *
 * @param outDir 输出目录
 * @param segmentsPath 赛段定义 JSON 路径（可选，缺失则两个产物都不产出）
 * @param activities 全部活动（成绩榜匹配输入）
 */
async function writeSegments(
  outDir: string,
  segmentsPath: string | undefined,
  activities: Array<{ summary: ActivitySummary; records: ActivityRecord[] }>,
): Promise<void> {
  if (segmentsPath === undefined) {
    return
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(segmentsPath, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Invalid segments source file: ${segmentsPath} (expected an array)`)
  }
  const segments = (raw as SegmentEntity[]).map((segment, index) => ({ ...segment, id: index + 1 }))
  await writeJson(outDir, 'segments.json', segments)

  const inputs: SegmentActivityInput[] = activities.map((item) => ({
    activityId: item.summary.id,
    startTime: item.summary.startTime,
    records: item.records,
  }))
  const results: SegmentResultsFile = {}
  for (const segment of segments) {
    results[String(segment.id)] = buildSegmentLeaderboard(segment, inputs)
  }
  await writeJson(outDir, 'precomputed/segment-results.json', results)
}

/**
 * 跨活动预计算产物：热力图抽稀轨迹、路线分组、功率纪录。
 * 访客端免全量逐点下载（设计 §2 决策 3）。
 *
 * @param outDir 输出目录
 * @param activities 全部活动
 */
async function writePrecomputed(
  outDir: string,
  activities: Array<{ summary: ActivitySummary; records: ActivityRecord[] }>,
): Promise<void> {
  const tracks: [number, number][][] = []
  const powerItems: ActivityPowerCurve[] = []
  const routeItems: RouteActivityInput[] = []
  for (const item of activities) {
    const points = simplifyRoute(item.records, TRACKS_SIMPLIFY_TOLERANCE_METERS)
    if (points.length >= MIN_TRACK_POINTS) {
      tracks.push(
        points.map((point) => [
          Number(point.latitude.toFixed(TRACK_COORDINATE_DECIMALS)),
          Number(point.longitude.toFixed(TRACK_COORDINATE_DECIMALS)),
        ]),
      )
    }
    powerItems.push({ activity: item.summary, curve: buildPowerCurve(item.records, POWER_RECORD_DURATIONS) })
    const endpoints = extractEndpoints(item.records)
    routeItems.push({
      id: item.summary.id,
      name: item.summary.name,
      startTime: item.summary.startTime,
      distance: item.summary.distance,
      duration: item.summary.duration,
      start: endpoints?.start,
      end: endpoints?.end,
    })
  }

  const tracksFile: TracksFile = { toleranceMeters: TRACKS_SIMPLIFY_TOLERANCE_METERS, tracks }
  await writeJson(outDir, 'precomputed/tracks.json', tracksFile)
  await writeJson(outDir, 'precomputed/power-records.json', buildPowerRecords(powerItems))
  await writeJson(outDir, 'precomputed/route-groups.json', buildRouteGroups(routeItems))
}

/**
 * 写出 JSON 产物（无缩进控制体积；传输压缩由 GitHub Pages 负责）。
 *
 * @param outDir 输出目录
 * @param name 相对文件名
 * @param data 可序列化数据
 */
async function writeJson(outDir: string, name: string, data: unknown): Promise<void> {
  await writeFile(join(outDir, name), JSON.stringify(data), 'utf8')
}

/**
 * Buffer → ArrayBuffer（fflate/指纹计算的标准入参形态）。
 *
 * @param bytes 文件字节
 */
function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
