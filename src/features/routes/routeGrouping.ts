/**
 * 路线分组（规格 §39 P2 路线分析）。
 *
 * 贪心聚类：按开始时间升序处理活动，起点与终点都在 proximity 阈值内、
 * 且距离与组均值相似（±10%）的活动归入同一条"路线"；都不满足时新建路线。
 * 组锚点取首个成员的端点（常骑路线起点稳定，锚点漂移小）。
 *
 * 完整 Segment（赛段匹配/成绩排行）不在本期范围，见 PROGRESS.md 后续工作项。
 */

/** 起终点判定半径（米）：同一路线的起终点允许的定位漂移 */
export const ROUTE_PROXIMITY_METERS = 500

/** 距离相似度容差：组平均距离的 ±10% */
export const ROUTE_DISTANCE_TOLERANCE = 0.1

/** 地球半径（米，haversine 用） */
const EARTH_RADIUS_METERS = 6_371_000

/** 经纬度坐标点 */
export interface RouteEndpoint {
  /** 纬度（十进制度） */
  latitude: number

  /** 经度（十进制度） */
  longitude: number
}

/** 路线分组的活动输入（摘要 + 首尾坐标） */
export interface RouteActivityInput {
  /** 活动 ID */
  id: string

  /** 开始时间（ISO 8601） */
  startTime: string

  /** 距离（米） */
  distance: number

  /** 骑行计时时长（秒） */
  duration: number

  /** 起点坐标（缺失的活动不参与分组） */
  start?: RouteEndpoint

  /** 终点坐标（缺失的活动不参与分组） */
  end?: RouteEndpoint
}

/** 一条路线（相似骑行的聚类结果） */
export interface RouteGroup {
  /** 组内活动（按开始时间升序） */
  activities: RouteActivityInput[]

  /** 骑行次数 */
  count: number

  /** 平均距离（米） */
  avgDistance: number

  /** 最快用时（秒，组内最短 duration） */
  bestDuration: number

  /** 最近骑行时间（ISO 8601） */
  lastRideTime: string

  /** 最近骑行活动 ID（卡片跳转详情用） */
  lastActivityId: string
}

/** 聚类内部状态：锚点端点 + 成员 */
interface GroupState {
  /** 锚点起点（首个成员起点） */
  anchorStart: RouteEndpoint

  /** 锚点终点（首个成员终点） */
  anchorEnd: RouteEndpoint

  /** 组内成员（按开始时间升序追加） */
  members: RouteActivityInput[]
}

/**
 * 路线分组：起终点 proximity + 距离相似度贪心聚类。
 *
 * @param items 活动输入（任意顺序，函数内按开始时间升序处理）
 * @param proximityMeters 起终点判定半径（默认 500 米）
 * @returns 路线组列表（按骑行次数降序，次数相同按最近骑行降序）
 */
export function buildRouteGroups(
  items: readonly RouteActivityInput[],
  proximityMeters: number = ROUTE_PROXIMITY_METERS,
): RouteGroup[] {
  const sorted = [...items].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const groups: GroupState[] = []

  for (const item of sorted) {
    if (item.start === undefined || item.end === undefined || item.distance <= 0) {
      continue
    }
    const target = groups.find((group) => matchesGroup(item, group, proximityMeters))
    if (target === undefined) {
      groups.push({ anchorStart: item.start, anchorEnd: item.end, members: [item] })
    } else {
      target.members.push(item)
    }
  }

  return groups
    .map((group) => toRouteGroup(group))
    .sort((a, b) => b.count - a.count || b.lastRideTime.localeCompare(a.lastRideTime))
}

/**
 * 判断活动是否属于某个组：起点/终点均在阈值内，且距离与组均值相似。
 *
 * @param item 活动输入
 * @param group 组状态
 * @param proximityMeters 起终点判定半径
 */
function matchesGroup(item: RouteActivityInput, group: GroupState, proximityMeters: number): boolean {
  // 调用方保证 start/end 存在
  const start = item.start as RouteEndpoint
  const end = item.end as RouteEndpoint
  if (haversineMeters(start, group.anchorStart) > proximityMeters) {
    return false
  }
  if (haversineMeters(end, group.anchorEnd) > proximityMeters) {
    return false
  }
  const avgDistance = group.members.reduce((sum, member) => sum + member.distance, 0) / group.members.length
  const tolerance = avgDistance * ROUTE_DISTANCE_TOLERANCE
  return Math.abs(item.distance - avgDistance) <= tolerance
}

/**
 * 组状态转展示用 RouteGroup。
 *
 * @param group 组状态
 */
function toRouteGroup(group: GroupState): RouteGroup {
  const totalDistance = group.members.reduce((sum, member) => sum + member.distance, 0)
  const best = group.members.reduce((min, member) => Math.min(min, member.duration), Number.POSITIVE_INFINITY)
  const last = group.members[group.members.length - 1]
  return {
    activities: group.members,
    count: group.members.length,
    avgDistance: totalDistance / group.members.length,
    bestDuration: best,
    lastRideTime: last.startTime,
    lastActivityId: last.id,
  }
}

/**
 * haversine 球面距离（米）。
 *
 * @param a 点 a
 * @param b 点 b
 * @returns 两点球面距离（米）
 */
export function haversineMeters(a: RouteEndpoint, b: RouteEndpoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}
