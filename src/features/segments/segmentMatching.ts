/**
 * 赛段匹配纯函数（后续工作项：完整 Segment）。
 *
 * 赛段 = 起点圆 + 终点圆（半径 200m）。轨迹按时间顺序先进入起点圆、
 * 之后再进入终点圆，即记一次成绩：计时 = 两个进入事件的时间差（秒）。
 * 同一活动多次穿过只取首次完整穿越（与 Strava 单次活动单成绩口径一致）。
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
 * 匹配单活动的赛段成绩：顺序穿越起点圆 → 终点圆。
 *
 * @param segment 赛段几何
 * @param records 完整逐点数据（按时间升序）
 * @returns 穿越用时（秒）；未完整穿越返回 undefined
 */
export function matchSegmentEffort(
  segment: SegmentGeometry,
  records: readonly ActivityRecord[],
): number | undefined {
  let startTimestamp: number | undefined

  for (const record of records) {
    if (record.latitude === undefined || record.longitude === undefined) {
      continue
    }

    if (startTimestamp === undefined) {
      if (
        withinCircle(
          record.latitude,
          record.longitude,
          segment.startLatitude,
          segment.startLongitude,
        )
      ) {
        startTimestamp = record.timestamp
      }
      continue
    }

    // 已进入起点圈：寻找晚于起点进入时刻的终点进入点（保证先后顺序）
    if (
      record.timestamp > startTimestamp &&
      withinCircle(
        record.latitude,
        record.longitude,
        segment.endLatitude,
        segment.endLongitude,
      )
    ) {
      return record.timestamp - startTimestamp
    }
  }
  return undefined
}

/**
 * 构造赛段成绩榜：各活动首次完整穿越的用时，按用时升序（最快在前）。
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
