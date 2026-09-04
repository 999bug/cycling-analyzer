/**
 * 数值/日期格式化工具（列表、详情、统计页共用）。
 * 所有函数对 null/undefined/NaN/Infinity 一律返回 '—'（表格空值占位）。
 * 单位约定与领域模型一致（src/types/activity.ts）：米、秒、m/s。
 */

/**
 * 判断数值是否有效（非 null/undefined/NaN/Infinity）。
 *
 * @param value 待校验数值
 * @returns 有效时为 true
 */
function isValidNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 格式化距离（米）：
 * - < 1000 m 显示整数米，如 '850 m'
 * - >= 1000 m 显示 2 位小数千米，如 '82.31 km'
 *
 * @param meters 距离（米）
 * @returns 格式化字符串，无效输入返回 '—'
 */
export function formatDistance(meters: number | null | undefined): string {
  if (!isValidNumber(meters)) {
    return '—'
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return `${(meters / 1000).toFixed(2)} km`
}

/**
 * 格式化时长（秒）为 H:MM:SS，小时位不折叠为天（超过 24h 显示 '26:30:10'）。
 *
 * @param seconds 时长（秒）
 * @returns 格式化字符串，无效输入返回 '—'
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (!isValidNumber(seconds)) {
    return '—'
  }
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(hours).padStart(2, '0')}:${pad(minutes)}:${pad(secs)}`
}

/**
 * 格式化速度（m/s）为千米每小时（1 位小数），如 '24.5 km/h'。
 *
 * @param mps 速度（m/s）
 * @returns 格式化字符串，无效输入返回 '—'
 */
export function formatSpeed(mps: number | null | undefined): string {
  if (!isValidNumber(mps)) {
    return '—'
  }
  return `${(mps * 3.6).toFixed(1)} km/h`
}

/**
 * 格式化海拔/爬升（米），带正负号，如 '+642 m'、'-50 m'。
 *
 * @param meters 海拔（米）
 * @returns 格式化字符串，无效输入返回 '—'
 */
export function formatElevation(meters: number | null | undefined): string {
  if (!isValidNumber(meters)) {
    return '—'
  }
  const sign = meters >= 0 ? '+' : ''
  return `${sign}${Math.round(meters)} m`
}

/**
 * 格式化时间为本地时区日期 'YYYY-MM-DD'（列表日期列、默认标题等）。
 *
 * @param iso ISO 8601 时间字符串
 * @returns 本地日期，无效输入返回 '—'
 */
export function formatDate(iso: string | null | undefined): string {
  if (iso == null) {
    return '—'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 本地时区日期键（YYYY-MM-DD，两位补零）。
 *
 * @param date 日期
 * @returns 本地日期键 'YYYY-MM-DD'
 */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 格式化时长（秒）为中文叙事文案："X 小时 Y 分" / "Y 分" / "Z 秒"。
 * 与 formatDuration（HH:MM:SS）不同：用于洞察/总结的自然语言呈现。
 *
 * @param seconds 时长（秒）
 * @returns 中文时长文案
 */
export function formatDurationText(seconds: number): string {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  }
  if (minutes > 0) {
    return `${minutes} 分`
  }
  return `${total} 秒`
}
