/**
 * Strava 批量导出元数据解析。
 *
 * Strava 导出的 FIT 文件本身不含活动标题，标题保存在 activities.csv 中。
 * 导入时解析该 CSV，按文件名关联还原原标题（规格 §31）。
 * CSV 为 UTF-8（可能带 BOM），字段支持引号转义与换行。
 */
import type { Activity } from '@/types/activity'

/**
 * Strava 活动元数据。
 */
export interface StravaActivityMeta {
  /** Strava 活动 ID */
  activityId: string
  /** 活动标题（用户原标题，可能为空） */
  name: string
  /** 活动类型（如 骑行 / Running） */
  activityType: string
  /** 导出文件名（如 activities/xxx.fit.gz） */
  fileName: string
  /** 活动描述（用户填写，可能为空） */
  description?: string
  /** 平均功率（W；无功率计活动为 Strava 估算值） */
  avgPower?: number
  /** 最大功率（W；无功率计活动为 Strava 估算值） */
  maxPower?: number
  /** 加权平均功率（W；Strava 加权平均口径） */
  weightedAvgPower?: number
}

/**
 * 解析 Strava activities.csv，返回按活动 ID 索引的元数据映射。
 *
 * @param csvText CSV 文本内容
 * @returns 活动 ID → 元数据
 */
export function parseStravaActivitiesCsv(csvText: string): Map<string, StravaActivityMeta> {
  const result = new Map<string, StravaActivityMeta>()
  // 去除 UTF-8 BOM（U+FEFF）
  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText
  const rows = parseCsvRows(text)
  if (rows.length < 2) {
    return result
  }

  const header = rows[0]
  const idIndex = header.indexOf('活动 ID')
  const nameIndex = header.indexOf('活动名称')
  const typeIndex = header.indexOf('活动类型')
  const fileIndex = header.indexOf('文件名')
  const descriptionIndex = header.indexOf('活动描述')
  const avgPowerIndex = header.indexOf('平均瓦特数')
  const maxPowerIndex = header.indexOf('最大瓦特数')
  const weightedAvgPowerIndex = header.indexOf('加权平均功率')
  if (idIndex < 0 || fileIndex < 0) {
    return result
  }

  for (let i = 1; i < rows.length; i++) {
    const fields = rows[i]
    const activityId = fields[idIndex]?.trim()
    if (!activityId) {
      continue
    }
    result.set(activityId, {
      activityId,
      name: nameIndex >= 0 ? fields[nameIndex]?.trim() ?? '' : '',
      activityType: typeIndex >= 0 ? fields[typeIndex]?.trim() ?? '' : '',
      fileName: fields[fileIndex]?.trim() ?? '',
      description: descriptionIndex >= 0 ? fields[descriptionIndex]?.trim() || undefined : undefined,
      avgPower: parseOptionalNumber(avgPowerIndex >= 0 ? fields[avgPowerIndex] : undefined),
      maxPower: parseOptionalNumber(maxPowerIndex >= 0 ? fields[maxPowerIndex] : undefined),
      weightedAvgPower: parseOptionalNumber(
        weightedAvgPowerIndex >= 0 ? fields[weightedAvgPowerIndex] : undefined,
      ),
    })
  }
  return result
}

/**
 * 解析可选的数字 CSV 单元格（空串/非数字返回 undefined）。
 *
 * @param raw 原始单元格文本
 * @returns 数值；空或非法时 undefined
 */
function parseOptionalNumber(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return undefined
  }
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

/**
 * 解析整个 CSV 文本为行/列二维数组。
 * 支持引号包裹字段（含逗号、换行、双引号转义）——引号内的换行不切行。
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(current)
      current = ''
    } else if (ch === '\n') {
      fields.push(current)
      current = ''
      rows.push(fields)
      fields = []
    } else if (ch !== '\r') {
      current += ch
    }
  }
  // 末行无换行结尾
  if (current.length > 0 || fields.length > 0) {
    fields.push(current)
    rows.push(fields)
  }
  return rows
}

/**
 * 从 Strava 元数据构建"文件名 → 标题"查找表。
 * 同时索引完整相对路径与纯文件名，覆盖选择导出根目录 / 子目录两种场景；
 * 标题为空的记录不参与还原。
 *
 * @param stravaCsv 活动 ID → 元数据映射（可为空）
 * @returns 文件名/相对路径 → 标题查找表
 */
export function buildStravaTitleLookup(
  stravaCsv: Map<string, StravaActivityMeta> | undefined,
): Map<string, string> {
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
export function matchStravaTitle(
  path: string,
  name: string,
  titles: Map<string, string>,
): string | undefined {
  return titles.get(path) ?? titles.get(name)
}

/**
 * 从 Strava 元数据构建"文件名 → 元数据"查找表。
 * 同时索引完整相对路径与纯文件名，覆盖选择导出根目录 / 子目录两种场景。
 *
 * @param stravaCsv 活动 ID → 元数据映射（可为空）
 * @returns 文件名/相对路径 → 元数据查找表
 */
export function buildStravaMetaLookup(
  stravaCsv: Map<string, StravaActivityMeta> | undefined,
): Map<string, StravaActivityMeta> {
  const metas = new Map<string, StravaActivityMeta>()
  for (const meta of stravaCsv?.values() ?? []) {
    metas.set(meta.fileName, meta)
    const slash = meta.fileName.lastIndexOf('/')
    if (slash >= 0) {
      metas.set(meta.fileName.slice(slash + 1), meta)
    }
  }
  return metas
}

/**
 * 按文件匹配 Strava 元数据：相对路径精确匹配优先，纯文件名回退。
 *
 * @param path 文件相对路径
 * @param name 纯文件名
 * @param metas 文件名 → 元数据查找表
 * @returns 匹配到的元数据，未匹配时 undefined
 */
export function matchStravaMeta(
  path: string,
  name: string,
  metas: Map<string, StravaActivityMeta>,
): StravaActivityMeta | undefined {
  return metas.get(path) ?? metas.get(name)
}

/**
 * 将 Strava 元数据补充到领域活动：
 * 描述直接写入；功率仅在 FIT 无数据（无功率计设备）时用 Strava 估算值填充，
 * 有实测功率的活动不被覆盖。
 *
 * @param activity 领域活动（就地修改）
 * @param meta Strava 元数据（可为空）
 */
export function applyStravaMeta(activity: Activity, meta: StravaActivityMeta | undefined): void {
  if (meta === undefined) {
    return
  }
  if (meta.description) {
    activity.description = meta.description
  }
  if (activity.avgPower === undefined && meta.avgPower !== undefined) {
    activity.avgPower = meta.avgPower
  }
  if (activity.maxPower === undefined && meta.maxPower !== undefined) {
    activity.maxPower = meta.maxPower
  }
  if (activity.normalizedPower === undefined && meta.weightedAvgPower !== undefined) {
    activity.normalizedPower = meta.weightedAvgPower
  }
}

/**
 * 从文件名提取活动标题（Strava 手动下载的单文件文件名 = 活动标题）。
 * 纯数字文件名（Strava 批量导出的活动 ID）不提取，避免显示数字标题。
 *
 * @param name 文件名（可含目录路径，如 机场东路有氧_平均心率138.fit）
 * @returns 标题；非 FIT 文件或纯数字 ID 文件名返回 undefined
 */
export function titleFromFileName(name: string): string | undefined {
  const baseName = name.slice(name.lastIndexOf('/') + 1)
  const match = /^(.+)\.(fit|fit\.gz)$/i.exec(baseName)
  if (!match) {
    return undefined
  }
  const base = match[1].trim()
  if (/^\d+$/.test(base)) {
    return undefined
  }
  return base.length > 0 ? base : undefined
}
