/**
 * 数据导出/导入（规格 §33）：JSON 备份，可迁移到其他电脑。
 *
 * 导出 JSON 结构（版本 1）：
 * {
 *   "app": "cycling-analyzer",
 *   "version": 1,
 *   "exportedAt": "2026-08-17T12:00:00.000Z",
 *   "activities": [ActivityEntity]   // 活动摘要（含 name），不含 records
 *   "records": [ActivityRecordEntity] // 逐点记录（含 activityId，无自增主键 id）
 *   "files": [FileEntity]            // 导入文件台账
 *   "settings": [SettingsEntry]      // 设置键值对，导入时按 key 合并
 * }
 *
 * 导入策略：
 * - activities 按 fingerprint 去重，已存在则跳过（规格 §9 同款判重）
 * - records 随所属活动一并写入（addActivity 事务内落库）
 * - files/settings 按主键（fingerprint/key）覆盖合并
 *
 * 说明：files/settings 的合并写入需要表级 put，仓库接口未提供
 * （files 仅 recordImported/recordFailed、settings 仅 get/set/delete），
 * 故本模块直接使用数据库表完成这两类合并，其余读写走仓库。
 */
import type { Activity, ActivityRecord } from '@/types/activity'
import type { ActivityEntity, ActivityRecordEntity, CyclingDatabase, FileEntity, SettingsEntry } from '@/storage/db'
import { db } from '@/storage/db'
import { DexieActivityRepository, type ActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieFileRepository, type FileRepository } from '@/storage/repositories/fileRepository'
import { DexieSettingsRepository, type SettingsRepository } from '@/storage/repositories/settingsRepository'

/** 导出格式应用标识 */
export const EXPORT_APP = 'cycling-analyzer'

/** 导出格式版本号（结构变更时递增，导入兼容低版本） */
export const EXPORT_VERSION = 1

/** 逐点记录分批读取的每批条数（防大数据量内存峰值） */
const DEFAULT_RECORD_BATCH_SIZE = 10_000

/** 默认活动仓库（全局数据库单例） */
const defaultActivityRepository = new DexieActivityRepository(db)

/** 默认文件台账仓库（全局数据库单例） */
const defaultFileRepository = new DexieFileRepository(db)

/** 默认设置仓库（全局数据库单例） */
const defaultSettingsRepository = new DexieSettingsRepository(db)

/** 导出数据包（文件格式，版本 1） */
export interface ExportBundle {
  /** 应用标识 */
  app: string

  /** 格式版本号 */
  version: number

  /** 导出时间（ISO 8601） */
  exportedAt: string

  /** 活动摘要（不含逐点记录） */
  activities: ActivityEntity[]

  /** 逐点记录（含 activityId，无自增主键） */
  records: ActivityRecordEntity[]

  /** 导入文件台账 */
  files: FileEntity[]

  /** 设置键值对 */
  settings: SettingsEntry[]
}

/** 导出选项 */
export interface ExportOptions {
  /** 数据库实例（settings 表全量导出用；测试注入独立实例） */
  db?: CyclingDatabase

  /** 活动仓库（测试注入独立实例） */
  activityRepository?: ActivityRepository

  /** 文件台账仓库（测试注入独立实例） */
  fileRepository?: FileRepository

  /** 设置仓库（测试注入独立实例） */
  settingsRepository?: SettingsRepository

  /** 逐点记录分批读取的每批条数（默认 10000） */
  recordBatchSize?: number

  /** 导出时间（测试注入固定值） */
  now?: Date
}

/** 导入汇总（页面提示文案用） */
export interface ImportBundleSummary {
  /** 新增活动数 */
  newImported: number

  /** 因 fingerprint 重复跳过的活动数 */
  skipped: number
}

/** 导入选项 */
export interface ImportOptions {
  /** 数据库实例（files 台账合并写入用；测试注入独立实例） */
  db?: CyclingDatabase

  /** 活动仓库（测试注入独立实例） */
  activityRepository?: ActivityRepository

  /** 设置仓库（测试注入独立实例） */
  settingsRepository?: SettingsRepository
}

/**
 * 导出全部本地数据为 JSON 数据包（规格 §33）。
 * 逐点记录按活动分批读取，避免数据量大时一次性加载进内存。
 *
 * @param options 导出选项
 * @returns 导出数据包（可直接 JSON 序列化）
 */
export async function exportData(options: ExportOptions = {}): Promise<ExportBundle> {
  const {
    db: dbInstance = db,
    activityRepository = defaultActivityRepository,
    fileRepository = defaultFileRepository,
    recordBatchSize = DEFAULT_RECORD_BATCH_SIZE,
    now = new Date(),
  } = options

  const [summaries, files, settings] = await Promise.all([
    activityRepository.listAllSummaries(),
    fileRepository.listAll(),
    dbInstance.settings.toArray(),
  ])

  // 逐活动分批读取逐点记录，并补上 activityId（getRecords 返回的领域记录不含归属）
  const records: ActivityRecordEntity[] = []
  for (const summary of summaries) {
    const batches = await listRecordsInBatches(activityRepository, summary.id, recordBatchSize)
    for (const record of batches) {
      records.push({ ...record, activityId: summary.id })
    }
  }

  return {
    app: EXPORT_APP,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    activities: summaries,
    records: records.map(stripRecordId),
    files,
    settings,
  }
}

/**
 * 解析并校验导入文件文本。
 *
 * @param text 文件内容
 * @returns 解析后的导出数据包
 * @throws Error 文件不是合法 JSON 或结构/版本不支持
 */
export function parseExportBundle(text: string): ExportBundle {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON format')
  }
  if (!isExportBundle(value)) {
    throw new Error(`Unsupported export format (app=${JSON.stringify((value as Record<string, unknown>)?.app)}, version=${JSON.stringify((value as Record<string, unknown>)?.version)})`)
  }
  return value
}

/**
 * 导入数据包：activities 按 fingerprint 去重，records 随活动写入，
 * files/settings 按主键合并覆盖。
 *
 * @param bundle 导出的数据包
 * @param options 导入选项
 * @returns 导入汇总（新增/跳过）
 */
export async function importBundle(bundle: ExportBundle, options: ImportOptions = {}): Promise<ImportBundleSummary> {
  const {
    db: dbInstance = db,
    activityRepository = defaultActivityRepository,
    settingsRepository = defaultSettingsRepository,
  } = options

  // 现有 fingerprint 集合：一次性读取在内存判重，避免逐活动查询
  const existing = new Set((await activityRepository.listAllSummaries()).map((a) => a.fingerprint))

  // 逐点记录按活动 ID 归组（同一活动的记录连续写入）
  const recordsByActivity = new Map<string, ActivityRecordEntity[]>()
  for (const record of bundle.records) {
    const group = recordsByActivity.get(record.activityId)
    if (group === undefined) {
      recordsByActivity.set(record.activityId, [record])
    } else {
      group.push(record)
    }
  }

  let newImported = 0
  let skipped = 0
  for (const entity of bundle.activities) {
    if (existing.has(entity.fingerprint)) {
      skipped++
      continue
    }
    const { name, ...summary } = entity
    const activity: Activity = { ...summary, records: recordsByActivity.get(entity.id) }
    await activityRepository.addActivity(activity, name)
    existing.add(entity.fingerprint)
    newImported++
  }

  // files 合并：主键 fingerprint，同一文件以导出时的原值覆盖
  for (const file of bundle.files) {
    await dbInstance.files.put(file)
  }

  // settings 合并：按 key 覆盖（同 key 以导出时的原值覆盖）
  for (const entry of bundle.settings) {
    await settingsRepository.set(entry.key, entry.value)
  }

  return { newImported, skipped }
}

/**
 * 触发浏览器下载 JSON 备份文件（Blob + 临时 URL + a[download]）。
 *
 * @param bundle 导出数据包
 * @param filename 下载文件名（默认 cycling-data-YYYY-MM-DD.json）
 */
export function downloadJson(bundle: ExportBundle, filename: string = defaultExportFilename(bundle.exportedAt)): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * 生成默认导出文件名（取导出日期的 YYYY-MM-DD）。
 *
 * @param exportedAt 导出时间（ISO 8601）
 * @returns 文件名，如 'cycling-data-2026-08-17.json'
 */
export function defaultExportFilename(exportedAt: string): string {
  return `cycling-data-${exportedAt.slice(0, 10)}.json`
}

/**
 * 结构校验：app/version/四类数组齐全即为受支持格式。
 *
 * @param value 解析后的未知值
 * @returns 是否合法导出数据包
 */
function isExportBundle(value: unknown): value is ExportBundle {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    candidate.app === EXPORT_APP &&
    typeof candidate.version === 'number' &&
    candidate.version >= 1 &&
    candidate.version <= EXPORT_VERSION &&
    Array.isArray(candidate.activities) &&
    Array.isArray(candidate.records) &&
    Array.isArray(candidate.files) &&
    Array.isArray(candidate.settings)
  )
}

/**
 * 分批读取一个活动的全部逐点记录。
 * 分批边界：返回条数小于批大小即视为读取完毕。
 *
 * @param repository 活动仓库
 * @param activityId 活动 ID
 * @param batchSize 每批条数
 * @returns 该活动的全部逐点记录
 */
async function listRecordsInBatches(
  repository: ActivityRepository,
  activityId: string,
  batchSize: number,
): Promise<ActivityRecord[]> {
  const all: ActivityRecord[] = []
  let offset = 0
  for (;;) {
    const batch = await repository.getRecords(activityId, { offset, limit: batchSize })
    all.push(...batch)
    if (batch.length < batchSize) {
      break
    }
    offset += batch.length
  }
  return all
}

/**
 * 剥离逐点记录的自增主键（导入时由 Dexie 重新生成）。
 *
 * @param record 数据库实体（含自增 id）
 * @returns 不含 id 的记录
 */
function stripRecordId(record: ActivityRecordEntity): Omit<ActivityRecordEntity, 'id'> {
  const rest = { ...record }
  delete rest.id
  return rest
}
