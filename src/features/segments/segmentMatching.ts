/**
 * 赛段匹配纯函数（后续工作项：完整 Segment）。
 *
 * 赛段 = 起点圆 + 终点圆（半径 200m）。轨迹按时间顺序进入起点圆、
 * 离开起点圆后再进入终点圆，即记一次成绩：计时 = 两个进入事件的时间差（秒）。
 * 同一活动多次穿越取最佳成绩（用时最短），与 Strava 单次活动最佳成绩口径一致。
 *
 * 环形路线防护：起终点圆重叠（如绕圈骑行起终点同在家门口）时，
 * 必须离开起点圆后进入终点圆才算完赛，避免"出发即完赛"的虚假成绩。
 */
import type { ActivityRecord } from '@/types/activity'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 起终点圆半径（米）：GPS 漂移容差 */
export const SEGMENT_RADIUS_METERS = 200

/**
 * 赛段几何（起终点圆心）。
 */
export interface SegmentGeometry {
  /** 起点纬度（十进制度） */
  startLatitude: number

  /** 起点经度（十进制度） */
  startLongitude: number

  /** 终点纬度（十进制度） */
  endLatitude: number

  /** 终点经度（十进制度） */
  endLongitude: number
}

/**
 * 一次赛段成绩。
 */
export interface SegmentEffort {
  /** 活动 ID */
  activityId: string

  /** 活动开始时间（ISO 8601，榜单展示用） */
  startTime: string

  /** 穿越用时（秒） */
  durationSeconds: number
}

/**
 * 参与赛段匹配的活动输入。
 */
export interface SegmentActivityInput {
  /** 活动 ID */
  activityId: string

  /** 活动开始时间（ISO 8601） */
  startTime: string

  /** 完整逐点数据 */
  records: readonly ActivityRecord[]
}

/**
 * 判断点是否在圆内。
 *
 * @param latitude 点纬度
 * @param longitude 点经度
 * @param centerLatitude 圆心纬度
 * @param centerLongitude 圆心经度
 * @returns 距离 ≤ 半径返回 true
 */
function withinCircle(
  latitude: number,
  longitude: number,
  centerLatitude: number,
  centerLongitude: number,
): boolean {
  return (
    haversineMeters(
      { latitude, longitude },
      { latitude: centerLatitude, longitude: centerLongitude },
    ) <= SEGMENT_RADIUS_METERS
  )
}

/**
 * 匹配单活动的赛段最佳成绩：进入起点圆 → 离开起点圆 → 进入终点圆。
 *
 * 状态机口径：
 * 1. 起点圆内（含初次进入、圈内停留、重新进入）：持续刷新计时起点，
 *    以离开圈前的最后一个圈内点为计时起点——扣除出发前停留/热身时间
 *    （「设为赛段」以骑行起终点建段，家门口环形路线开机停留不应计入成绩）；
 * 2. 离开起点圆后才允许判终点（环形路线防护：起终点同圆时防止出发即完赛）；
 *    两圆相交/同心（圆心距 < 2R）时「离开」指离开两圆并集：出起点圈但仍在
 *    终点圈内的点不判完赛，防止出发第一步撞终点圈产生秒级虚假成绩；
 * 3. 寻找终点：先判终点（终点判定优先），未达终点而重新进入起点圆则重新计时；
 *    完赛点若同时在起点圆内（环形连续圈）立即作为下一次穿越的计时起点。
 *
 * @param segment 赛段几何
 * @param records 完整逐点数据（按时间升序）
 * @returns 多次穿越的最佳用时（秒）；未完整穿越返回 undefined
 */
export function matchSegmentEffort(
  segment: SegmentGeometry,
  records: readonly ActivityRecord[],
): number | undefined {
  // 两圆相交/同心（圆心距小于直径）时，出起点圈的点可能仍落在终点圈内
  const circlesOverlap =
    haversineMeters(
      { latitude: segment.startLatitude, longitude: segment.startLongitude },
      { latitude: segment.endLatitude, longitude: segment.endLongitude },
    ) <
    2 * SEGMENT_RADIUS_METERS

  let startTimestamp: number | undefined
  let leftStartCircle = false
  let best: number | undefined

  for (const record of records) {
    if (record.latitude === undefined || record.longitude === undefined) {
      continue
    }

    const inStart = withinCircle(
      record.latitude,
      record.longitude,
      segment.startLatitude,
      segment.startLongitude,
    )
    const inEnd = withinCircle(
      record.latitude,
      record.longitude,
      segment.endLatitude,
      segment.endLongitude,
    )

    if (!leftStartCircle) {
      if (inStart) {
        // 圈内最后一点才是计时起点：停留/热身时间随刷新自然扣除
        startTimestamp = record.timestamp
        continue
      }
      if (startTimestamp === undefined) {
        continue
      }
      if (circlesOverlap && inEnd) {
        // 相交圆：出起点圈但仍在终点圈内 = 未离开并集，等真正离开
        continue
      }
      leftStartCircle = true
      // 独立圆：离开起点圈的同一点可继续判终点（稀疏记录直接从起点圈跳到终点圈）
    }

    // startTimestamp 在 leftStartCircle=true 时必已定义，显式判断仅为通过 TS 窄化
    if (inEnd && startTimestamp !== undefined && record.timestamp > startTimestamp) {
      const duration = record.timestamp - startTimestamp
      if (best === undefined || duration < best) {
        best = duration
      }
      startTimestamp = inStart ? record.timestamp : undefined
      leftStartCircle = false
      continue
    }

    if (inStart) {
      startTimestamp = record.timestamp
      leftStartCircle = false
    }
  }
  return best
}

/**
 * 构造赛段成绩榜：各活动最佳穿越的用时，按用时升序（最快在前）。
 *
 * @param segment 赛段几何
 * @param inputs 参与匹配的活动列表
 * @returns 成绩榜（无穿越的活动不出现）
 */
export function buildSegmentLeaderboard(
  segment: SegmentGeometry,
  inputs: readonly SegmentActivityInput[],
): SegmentEffort[] {
  const efforts: SegmentEffort[] = []
  for (const input of inputs) {
    const durationSeconds = matchSegmentEffort(segment, input.records)
    if (durationSeconds !== undefined) {
      efforts.push({
        activityId: input.activityId,
        startTime: input.startTime,
        durationSeconds,
      })
    }
  }
  return efforts.sort((a, b) => a.durationSeconds - b.durationSeconds)
}
