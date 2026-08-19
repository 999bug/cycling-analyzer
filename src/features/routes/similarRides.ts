/**
 * 匹配的骑行查找（Strava Similar Rides 的等价实现）。
 *
 * 基于路线聚类结果：与指定活动同组（起终点 500m 内 + 距离 ±10%）的其他骑行
 * 即为匹配活动，按开始时间降序展示。
 */
import type { RouteGroup } from '@/features/routes/routeGrouping'

/** 一条匹配的骑行（同路线其他活动） */
export interface SimilarRide {
  /** 活动 ID */
  id: string

  /** 活动标题（可为空） */
  name?: string

  /** 开始时间（ISO 8601） */
  startTime: string

  /** 距离（米） */
  distance: number

  /** 骑行计时时长（秒） */
  duration: number
}

/**
 * 查找与指定活动同一路线分组的其他骑行。
 *
 * @param groups 路线分组（null 表示尚未计算）
 * @param activityId 当前活动 ID
 * @returns 同组其他骑行（按开始时间降序）；不在任何分组或组内仅自身时为空数组
 */
export function findMatchingRides(
  groups: readonly RouteGroup[] | null,
  activityId: string,
): SimilarRide[] {
  if (groups === null) {
    return []
  }
  for (const group of groups) {
    if (!group.activities.some((activity) => activity.id === activityId)) {
      continue
    }
    return group.activities
      .filter((activity) => activity.id !== activityId)
      .sort((a, b) => b.startTime.localeCompare(a.startTime))
  }
  return []
}

/**
 * 轨迹点归一化为 SVG polyline points（拉伸铺满视口，纬度向上）。
 * Strava 匹配活动列表的迷你轨迹图风格。
 *
 * @param track 轨迹点（[纬度, 经度] 元组）
 * @param width 视口宽
 * @param height 视口高
 * @returns SVG points 字符串（不足 2 点返回空串）
 */
export function trackToSvgPoints(
  track: readonly [number, number][],
  width: number,
  height: number,
): string {
  if (track.length < 2) {
    return ''
  }
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const [lat, lng] of track) {
    if (lat < minLat) {
      minLat = lat
    }
    if (lat > maxLat) {
      maxLat = lat
    }
    if (lng < minLng) {
      minLng = lng
    }
    if (lng > maxLng) {
      maxLng = lng
    }
  }
  const latSpan = maxLat - minLat || 1
  const lngSpan = maxLng - minLng || 1
  return track
    .map(([lat, lng]) => {
      const x = ((lng - minLng) / lngSpan) * width
      const y = height - ((lat - minLat) / latSpan) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * 用时对比结果：与本次骑行相比对方快/慢。
 */
export interface DurationComparison {
  /** true = 对方更快；false = 对方更慢；null = 用时相等 */
  faster: boolean | null

  /** 差值（秒，绝对值） */
  diffSeconds: number
}

/**
 * 比较本次骑行与匹配骑行的用时（Strava 竞速提示：比本次快/慢）。
 * 任一时长缺失返回 null（不比较）。
 *
 * @param currentSeconds 本次骑行时长（秒）
 * @param otherSeconds 匹配骑行时长（秒）
 * @returns 对比结果；无法比较时 null
 */
export function compareDurations(
  currentSeconds: number | null | undefined,
  otherSeconds: number | null | undefined,
): DurationComparison | null {
  if (typeof currentSeconds !== 'number' || typeof otherSeconds !== 'number') {
    return null
  }
  if (currentSeconds === otherSeconds) {
    return { faster: null, diffSeconds: 0 }
  }
  return {
    faster: otherSeconds < currentSeconds,
    diffSeconds: Math.abs(currentSeconds - otherSeconds),
  }
}
