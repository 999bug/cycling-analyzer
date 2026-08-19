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
