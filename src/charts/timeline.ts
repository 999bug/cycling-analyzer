/**
 * 共享时间轴工具（规格 §17 增强：图表/剖面/地图联动）。
 *
 * 详情页持有唯一悬停状态 hoverTimestamp（Unix 秒），
 * 各图表与爬坡剖面通过 onHover 上报、通过 hoverTimestamp 渲染外部光标，
 * 地图将 hoverTimestamp 换算成轨迹点坐标显示圆点；地图悬停反向上报。
 * 本模块只提供与 UI 无关的纯函数与常量，便于单测。
 */
import type { ActivityRecord, RoutePoint } from '@/types/activity'
import type { ChartSeriesPoint, CombinedSeriesPoint } from '@/charts/series'

/** 悬停光标颜色（与 recharts 默认 tooltip cursor 一致，浅色主题下仍可辨） */
export const TIMELINE_CURSOR_COLOR = 'var(--text-secondary)'

/** 悬停光标虚线样式（SVG strokeDasharray） */
export const TIMELINE_CURSOR_DASH = '4 3'

/** 距离阈值（米）：地图悬停点与轨迹点的最近匹配上限，超过则不上报 */
const MAP_HOVER_MAX_DISTANCE_METERS = 100

/**
 * 在按时间升序的点列表中找 timestamp 最接近目标的点。
 * 列表需有序（图表 series 均为按时间升序），二分查找 O(log n)。
 *
 * @param points 带 timestamp 的点列表（升序）
 * @param target 目标时间戳（Unix 秒）
 * @returns 最接近的点；空列表返回 undefined
 */
export function findNearestByTimestamp<T extends { timestamp: number }>(
  points: readonly T[],
  target: number,
): T | undefined {
  if (points.length === 0) {
    return undefined
  }
  let low = 0
  let high = points.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (points[mid].timestamp < target) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  // low 为第一个 ≥ target 的下标；候选为 low 与 low-1，取更接近者
  const after = points[low]
  const before = points[low - 1]
  if (before === undefined) {
    return after
  }
  if (after === undefined) {
    return before
  }
  return target - before.timestamp <= after.timestamp - target ? before : after
}

/**
 * 悬停位置 → 轨迹点（地图圆点）。
 * 在轨迹点中找 timestamp 最接近悬停时间的点。
 *
 * @param routePoints 抽稀后的轨迹点
 * @param timestamp 悬停时间戳（Unix 秒）
 * @returns 对应轨迹点；无轨迹或悬停为空返回 undefined
 */
export function routePointAtTimestamp(
  routePoints: readonly RoutePoint[],
  timestamp: number | undefined,
): RoutePoint | undefined {
  if (timestamp === undefined) {
    return undefined
  }
  return findNearestByTimestamp(routePoints, timestamp)
}

/**
 * 地图悬停（经纬度）→ 轨迹点（反向联动）。
 * 与悬停点直线距离最近且不超过阈值时返回对应轨迹点，否则 undefined。
 *
 * @param routePoints 抽稀后的轨迹点（含坐标）
 * @param latitude 悬停纬度
 * @param longitude 悬停经度
 * @returns 匹配轨迹点；无匹配返回 undefined
 */
export function routePointAtLocation(
  routePoints: readonly RoutePoint[],
  latitude: number,
  longitude: number,
): RoutePoint | undefined {
  if (routePoints.length === 0) {
    return undefined
  }
  let best: RoutePoint | undefined
  let bestDistance = Infinity
  for (const point of routePoints) {
    const distance = haversineMeters(latitude, longitude, point.latitude, point.longitude)
    if (distance < bestDistance) {
      bestDistance = distance
      best = point
    }
  }
  return best !== undefined && bestDistance <= MAP_HOVER_MAX_DISTANCE_METERS ? best : undefined
}

/**
 * 两点球面距离（米，Haversine）。
 *
 * @param lat1 纬度 1
 * @param lng1 经度 1
 * @param lat2 纬度 2
 * @param lng2 经度 2
 * @returns 距离（米）
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a))
}

/**
 * 逐点记录中 timestamp 最接近悬停时间的记录。
 * 用于剖面等基于完整 records 的场景。
 *
 * @param records 逐点记录（按时间升序）
 * @param timestamp 悬停时间戳
 * @returns 最接近的记录；空列表返回 undefined
 */
export function recordAtTimestamp(
  records: readonly ActivityRecord[],
  timestamp: number,
): ActivityRecord | undefined {
  return findNearestByTimestamp(records, timestamp)
}

/** 可匹配 timestamp 的 series 点类型（单指标图与组合图共有字段） */
export type TimelineSeriesPoint = ChartSeriesPoint | CombinedSeriesPoint

/**
 * 悬停时间戳 → 图表序列点（用于 ReferenceLine 定位 x）。
 *
 * @param series 图表序列点（按时间升序）
 * @param timestamp 悬停时间戳
 * @returns 最接近的序列点；空序列或无悬停返回 undefined
 */
export function seriesPointAtTimestamp(
  series: readonly TimelineSeriesPoint[],
  timestamp: number | undefined,
): TimelineSeriesPoint | undefined {
  if (timestamp === undefined) {
    return undefined
  }
  return findNearestByTimestamp(series, timestamp)
}