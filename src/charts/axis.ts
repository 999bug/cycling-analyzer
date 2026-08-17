/**
 * 图表 X 轴刻度/提示格式化（规格 §17）。
 *
 * time 模式输入为距起点秒数，distance 模式输入为累计距离（米），
 * 与 series.ts 的 x 值单位一一对应。
 */

/**
 * 时间轴格式：不足 1 小时 "M:SS"，否则 "H:MM:SS"。
 *
 * @param seconds 距起点秒数
 * @returns 如 "12:34" / "1:02:34"
 */
export function formatAxisTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

/**
 * 距离轴格式：不足 1km 显示米，否则保留 1 位小数千米。
 *
 * @param meters 累计距离（米）
 * @returns 如 "850 m" / "12.5 km"
 */
export function formatAxisDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return `${(meters / 1000).toFixed(1)} km`
}
