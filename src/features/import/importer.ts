/**
 * 导入执行器（规格 §8/§9/§21/§22/§24）。
 *
 * 逐文件 pipeline：读字节 → gzip 解压（如需要）→ 计算指纹 →
 * 指纹去重（存在则跳过，规格 §9）→ worker 解析（解码 + 标准化）→
 * Strava CSV 标题还原（规格 §31）→ 落库 + 台账。
 *
 * 错误分类（规格 §24）：非 FIT / CRC 损坏映射为中文文案，其余保留原始错误。
 * 失败文件写入台账（fingerprint 在解压后字节上计算，解压本身失败的文件
 * 无法获得指纹，仅展示于失败列表）。
 *
 * 解析执行器可注入（测试传纯函数），默认按环境选择：
 * - 浏览器（Worker 可用）→ Web Worker 解析；
 * - 测试环境（jsdom 无 Worker）→ 主线程直接解析。
 */
import { DexieActivityRepository, type ActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieFileRepository, type FileRepository } from '@/storage/repositories/fileRepository'
import { db } from '@/storage/db'
import { computeFingerprint } from '@/utils/fingerprint'
import type { ParseFileFn } from '@/fit/worker/parseTask'
import { calculateNormalizedPower } from '@/features/analysis/normalizedPower'
import { gunzipBytes, shouldGunzip } from './gzip'
import { classifyParseError } from './errorClassifier'
import { createWorkerParser } from './parseClient'
import {
  applyStravaMeta,
  buildStravaMetaLookup,
  matchStravaMeta,
  titleFromFileName,
  type StravaActivityMeta,
} from './stravaExport'

/**
 * 待导入的单个文件（由扫描结果归一化而来）。
 */
export interface ImportFile {
  /** 相对路径（Strava CSV 标题还原的匹配键） */
  path: string

  /** 纯文件名 */
  name: string

  /** 文件对象 */
  file: File

  /** 手动编辑的活动标题（单文件导入弹窗填写，优先于 CSV/文件名还原） */
  title?: string

  /** 手动编辑的活动描述（单文件导入弹窗填写，优先于 CSV 还原） */
  description?: string

  /** 手动填写的个人备注（单文件导入弹窗填写） */
  note?: string
}

/**
 * 导入选项。
 */
export interface ImportOptions {
  /** 单文件解析函数（默认按环境选择 worker / 主线程；测试注入纯函数） */
  parser?: ParseFileFn

  /** 活动仓库（测试注入独立数据库实例） */
  activityRepository?: ActivityRepository

  /** 文件台账仓库（测试注入独立数据库实例） */
  fileRepository?: FileRepository

  /** Strava activities.csv 元数据（活动 ID → 元数据，标题还原用） */
  stravaCsv?: Map<string, StravaActivityMeta>

  /** 进度回调（每处理完一个文件调用一次，current 从 1 开始） */
  onProgress?: (current: number, total: number) => void

  /** 是否在台账中保存原始 FIT 字节（规格 §19，默认不保存） */
  saveOriginalFit?: boolean
}

/**
 * 单个失败文件的记录。
 */
export interface FailedItem {
  /** 源文件名 */
  fileName: string

  /** 分类后的错误文案（规格 §24） */
  error: string
}

/**
 * 导入汇总（规格 §9 UI 文案：发现 N 个 FIT 文件 新增 X 个 已存在 Y 个 失败 Z 个）。
 */
export interface ImportSummary {
  /** 本次导入的文件总数 */
  total: number

  /** 成功新增的活动数 */
  newImported: number

  /** 因内容指纹重复而跳过的文件数（规格 §9） */
  skipped: number

  /** 失败的文件数 */
  failed: number

  /** 失败明细（文件名 + 原因） */
  failedItems: FailedItem[]
}

/** 默认活动仓库（全局数据库单例） */
const defaultActivityRepository = new DexieActivityRepository(db)

/** 默认文件台账仓库（全局数据库单例） */
const defaultFileRepository = new DexieFileRepository(db)

/**
 * 批量导入 FIT 文件。
 *
 * @param files 待导入文件（扫描归一化结果）
 * @param options 导入选项
 * @returns 导入汇总
 */
export async function importFiles(files: ImportFile[], options: ImportOptions = {}): Promise<ImportSummary> {
  const {
    parser = createDefaultParser(),
    activityRepository = defaultActivityRepository,
    fileRepository = defaultFileRepository,
  } = options
  const metas = buildStravaMetaLookup(options.stravaCsv)
  const failedItems: FailedItem[] = []
  let newImported = 0
  let skipped = 0

  for (let index = 0; index < files.length; index++) {
    const entry = files[index]
    let fingerprint: string | undefined
    try {
      const bytes = await entry.file.arrayBuffer()
      const content = shouldGunzip(entry.name, bytes) ? gunzipBytes(bytes) : bytes
      fingerprint = await computeFingerprint(content)

      if (await activityRepository.existsByFingerprint(fingerprint)) {
        skipped++
      } else {
        const meta = matchStravaMeta(entry.path, entry.name, metas)
        const activity = await parser({ fileName: entry.name, bytes: content, fingerprint })
        // 导入时顺带计算 NP 落库（原始派生值、与 FTP 无关）：
        // 训练状态等全量聚合直接读摘要，避免每次全量扫描逐点数据
        const normalizedPower = calculateNormalizedPower(activity.records ?? [])
        if (normalizedPower !== undefined) {
          activity.normalizedPower = normalizedPower
        }
        // Strava 元数据补充：描述 + 无功率计时用估算功率填充
        applyStravaMeta(activity, meta)
        // 手动编辑覆盖（单文件导入弹窗）：标题 > CSV > 文件名兜底；描述/备注直接覆盖
        if (entry.description !== undefined) {
          activity.description = entry.description
        }
        if (entry.note !== undefined) {
          activity.note = entry.note
        }
        const title =
          entry.title || (meta?.name ? meta.name : undefined) || titleFromFileName(entry.name)
        await activityRepository.addActivity(activity, title)
        // 规格 §19：开启「保存原始 FIT 文件」时解压后字节随台账落库
        await fileRepository.recordImported(
          fingerprint,
          entry.name,
          content.byteLength,
          options.saveOriginalFit === true ? content : undefined,
        )
        newImported++
      }
    } catch (error) {
      const message = classifyParseError(error)
      failedItems.push({ fileName: entry.name, error: message })
      if (fingerprint) {
        // 台账记录失败不阻断导入流程
        await fileRepository.recordFailed(fingerprint, entry.name, message).catch(() => {})
      }
    }
    options.onProgress?.(index + 1, files.length)
  }

  return { total: files.length, newImported, skipped, failed: failedItems.length, failedItems }
}

/**
 * 按环境选择默认解析器：浏览器走 worker，测试环境（jsdom 无 Worker）走主线程。
 * 主线程降级用动态 import（性能优化）：@garmin/fitsdk 只随 worker chunk
 * 或降级路径按需加载，不进首屏主包。
 */
function createDefaultParser(): ParseFileFn {
  if (typeof Worker !== 'undefined') {
    return createWorkerParser()
  }
  return async (input) => {
    const { parseFitBytes } = await import('@/fit/worker/parseTask')
    return parseFitBytes(input)
  }
}
