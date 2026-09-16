/**
 * 作者数据快照构建核心（CI 与本地共用，设计见 docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md）。
 *
 * 流程：递归扫描 fit 目录 → gzip 解压 → 指纹去重 → 解析标准化 → NP 计算 →
 * 摘要/逐点拆分写出 → 跨活动预计算（热力图轨迹/赛段榜/路线分组/功率纪录）。
 *
 * 设计要点：
 * - 活动 ID = 文件内容指纹（确定性）：重复构建 ID 不变，详情页深链跨部署存活
 * - 解析失败默认**跳过并告警**（`onParseError: 'skip'`）：单个坏文件不应让整站发不出去，
 *   但必须留下日志与 CI 注解，不允许静默少数据；本地排查可传 'fail' 走 fail-fast
 * - 解析完全复用 src 的浏览器侧纯函数（fflate/@garmin/fitsdk 均跨环境）
 *
 * 不做增量构建的理由（2026-09-16 实测）：全量构建 87 个 FIT / 12MB 输入只需 **7.0s**，
 * 而缓存 157MB 产物在 CI 上的上传/下载时间显著超过重建成本，纯属负优化。
 * 数据量再涨一个数量级（~900 个活动、~70s）时重新评估。
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseFitBytes } from '@/fit/worker/parseTask'
import { computeFingerprint } from '@/utils/fingerprint'
import { gunzipBytes, shouldGunzip } from '@/features/import/gzip'
import { calculateNormalizedPower } from '@/features/analysis/normalizedPower'
import {
  applyStravaMeta,
  buildStravaMetaLookup,
  decodeTextAuto,
  matchStravaMeta,
  parseStravaActivitiesCsv,
  titleFromFileName,
  type StravaActivityMeta,
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
  type RouteTracksFile,
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

  /**
   * 解析失败策略。
   *
   * 缺省 `'skip'`：跳过坏文件并**大声**告警，构建继续完成。
   * 理由：单个坏 FIT 让整站发不出去，代价远大于「少一条活动」——站点会一直停在
   * 上一版，作者的新内容全部上不去。但跳过的文件必须有痕迹（日志 + CI 注解），
   * 否则就成了「静默少数据」，那是本脚本明确要避免的失败模式。
   *
   * `'fail'`：立即抛错。本地排查坏文件、或需要保证快照完整性时使用。
   */
  onParseError?: ParseFailureStrategy
}

/** 解析失败策略 */
export type ParseFailureStrategy =
  /** 跳过并告警（默认） */
  | 'skip'
  /** 立即抛错（fail-fast） */
  | 'fail'

/** 被跳过的 FIT 文件 */
export interface SkippedFitFile {
  /** 相对 fitDir 的路径 */
  file: string

  /** 失败原因（解析器给出的错误消息） */
  reason: string
}

/** 快照构建统计 */
export interface BuildAuthorDataStats {
  /** 扫描到的 FIT 文件数 */
  files: number

  /** 成功解析入库的活动数 */
  parsed: number

  /** 因内容指纹重复跳过的文件数 */
  duplicates: number

  /** 解析失败被跳过的文件（onParseError='skip' 时可能非空） */
  skipped: readonly SkippedFitFile[]
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
  const strategy: ParseFailureStrategy = options.onParseError ?? 'skip'
  const files = await scanFitFiles(fitDir)
  const metas = await loadMetaLookup(options.csvPath)

  const seen = new Set<string>()
  const activities: Array<{ summary: ActivitySummary; records: ActivityRecord[] }> = []
  const skipped: SkippedFitFile[] = []
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
      if (strategy === 'fail') {
        throw new Error(`Failed to parse author FIT file ${file.relPath}: ${reason}`, { cause: error })
      }
      skipped.push({ file: file.relPath, reason })
      emitWarning(`跳过无法解析的 FIT 文件 ${file.relPath}：${reason}`)
      continue
    }
    // 确定性 ID = 内容指纹（覆盖 parseFitBytes 的随机 UUID），重建深链不变
    const normalizedPower = calculateNormalizedPower(activity.records ?? [])
    if (normalizedPower !== undefined) {
      activity.normalizedPower = normalizedPower
    }
    // Strava 元数据补充：描述 + 无功率计时用估算功率填充（标题同样优先 CSV）
    const meta = matchStravaMeta(file.relPath, file.name, metas)
    applyStravaMeta(activity, meta)
    const named: Activity = {
      ...activity,
      id: fingerprint,
      fileId: fingerprint,
      name: meta?.name || titleFromFileName(file.name),
    }
    activities.push({ summary: toSummary(named), records: toRecords(named) })
  }

  activities.sort((a, b) => b.summary.startTime.localeCompare(a.summary.startTime))

  // 全军覆没时不要发布空快照：那会让线上的作者模式整个消失，比「少几条」严重得多。
  // 一个都没解析成功，说明环境/格式层面出了问题，应当中止
  if (files.length > 0 && activities.length === 0) {
    throw new Error(
      `No author activity could be parsed (${files.length} files scanned, ${skipped.length} failed)`,
    )
  }

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

  return { files: files.length, parsed: activities.length, duplicates, skipped }
}

/**
 * 输出告警。
 *
 * 在 GitHub Actions 下额外发一条 workflow command 注解：跳过的文件必须出现在
 * 运行页顶部，而不是被上千行构建日志淹没——P2 把「坏文件阻塞发布」改成
 * 「跳过并继续」的代价就是必须让跳过足够显眼。
 *
 * @param message 告警文本
 */
function emitWarning(message: string): void {
  console.warn(`[author-data] ${message}`)
  if (process.env.GITHUB_ACTIONS === 'true') {
    // workflow command 需转义 %、CR、LF，否则注解会被截断
    const escaped = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
    console.log(`::warning title=author-data::${escaped}`)
  }
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
 * 加载 Strava 元数据查找表（CSV 不存在时返回空表）。
 *
 * @param csvPath activities.csv 路径（可选）
 */
async function loadMetaLookup(csvPath: string | undefined): Promise<Map<string, StravaActivityMeta>> {
  if (csvPath === undefined) {
    return new Map()
  }
  try {
    // 编码探测解码：Strava 中文账号导出的 activities.csv 可能为 GB18030，固定 utf8 会丢表头
    const text = decodeTextAuto(new Uint8Array(await readFile(csvPath)))
    return buildStravaMetaLookup(parseStravaActivitiesCsv(text))
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
    description: activity.description,
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
      // 缺失必须留下痕迹：静默 return 会让「产物没生成」与「本来就没有赛段数据」
      // 在前端表现完全一致，与本脚本其它环节的告警口径不一致
      emitWarning(`赛段定义文件不存在，跳过赛段与成绩榜产物：${segmentsPath}`)
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

  // 路线分组 + 路线 → 轨迹映射（路线总览地图页：轨迹按路线归属着色）
  const routeGroups = buildRouteGroups(routeItems)
  const trackById = new Map(activities.map((item, index) => [item.summary.id, tracks[index]]))
  const routeTracksFile: RouteTracksFile = {
    toleranceMeters: TRACKS_SIMPLIFY_TOLERANCE_METERS,
    routes: routeGroups
      .map((group) => ({
        activityIds: group.activities.map((activity) => activity.id),
        tracks: group.activities
          .map((activity) => trackById.get(activity.id))
          .filter((track): track is [number, number][] => track !== undefined),
        count: group.count,
        name: group.lastActivityName,
        lastActivityId: group.lastActivityId,
      }))
      .filter((route) => route.tracks.length > 0),
  }
  await writeJson(outDir, 'precomputed/route-groups.json', routeGroups)
  await writeJson(outDir, 'precomputed/route-tracks.json', routeTracksFile)
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
