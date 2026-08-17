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
import { parseFitBytes, type ParseFileFn } from '@/fit/worker/parseTask'
import { gunzipBytes, shouldGunzip } from './gzip'
import { classifyParseError } from './errorClassifier'
import { createWorkerParser } from './parseClient'
import type { StravaActivityMeta } from './stravaExport'

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
  const titles = buildTitleLookup(options.stravaCsv)
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
        const activity = await parser({ fileName: entry.name, bytes: content, fingerprint })
        await activityRepository.addActivity(activity, matchTitle(entry.path, entry.name, titles))
        await fileRepository.recordImported(fingerprint, entry.name, content.byteLength)
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
 */
function createDefaultParser(): ParseFileFn {
  if (typeof Worker !== 'undefined') {
    return createWorkerParser()
  }
  return async (input) => parseFitBytes(input)
}

/**
 * 从 Strava 元数据构建"文件名 → 标题"查找表。
 * 同时索引完整相对路径与纯文件名，覆盖选择导出根目录 / 子目录两种场景；
 * 标题为空的记录不参与还原。
 */
function buildTitleLookup(stravaCsv: Map<string, StravaActivityMeta> | undefined): Map<string, string> {
  const titles = new Map<string, string>()
  for (const meta of stravaCsv?.values() ?? []) {
    if (!meta.name) {
      continue
    }
    titles.set(meta.fileName, meta.name)
    const slash = meta.fileName.lastIndexOf('/')
    if (slash >= 0) {
      titles.set(meta.fileName.slice(slash + 1), meta.name)
    }
  }
  return titles
}

/**
 * 按文件匹配 Strava 标题：相对路径精确匹配优先，纯文件名回退。
 *
 * @param path 文件相对路径
 * @param name 纯文件名
 * @param titles 文件名 → 标题查找表
 * @returns 匹配到的标题（可空），未匹配时 undefined
 */
function matchTitle(path: string, name: string, titles: Map<string, string>): string | undefined {
  return titles.get(path) ?? titles.get(name)
}
