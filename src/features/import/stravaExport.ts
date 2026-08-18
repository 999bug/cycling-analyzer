/**
 * Strava 批量导出元数据解析。
 *
 * Strava 导出的 FIT 文件本身不含活动标题，标题保存在 activities.csv 中。
 * 导入时解析该 CSV，按文件名关联还原原标题（规格 §31）。
 * CSV 为 UTF-8（可能带 BOM），字段支持引号转义与换行。
 */

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
    })
  }
  return result
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
