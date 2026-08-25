/**
 * 赛段匹配纯函数（后续工作项：完整 Segment）。
 *
 * 赛段 = 起点圆 + 终点圆（半径 200m）。轨迹按时间顺序进入起点圆、
 * 离开起点圆后再进入终点圆，即记一次成绩：计时 = 两个进入事件的时间差（秒）。
 * 同一活动多次穿越取最佳成绩（用时最短），与 Strava 单次活动最佳成绩口径一致。
 *
 * 环形路线防护：起终点圆重叠（如绕圈骑行起终点同在家门口）时，
 * 必须离开起点圆后进入终点圆才算完赛，避免"出发即完赛"的虚假成绩。
 *
 * 性能（GPX 导入卡死修复）：路径校验 trackMatchesPath 采用
 * 包围盒预筛 + 赛段轨迹抽稀 + 中位数提前退出三层降复杂度；
 * 同一穿越段的路径校验结果缓存，盘山路折返反复撞终点圆不再重复计算。
 */
import type { ActivityRecord } from '@/types/activity'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 起终点圆半径（米）：GPS 漂移容差 */
export const SEGMENT_RADIUS_METERS = 200

/** 路径相似度阈值（米）：活动轨迹点到赛段轨迹中位数距离超过该值判定为路径不重合 */
const PATH_SIMILARITY_THRESHOLD_METERS = 100

/** 路径校验用赛段轨迹抽稀上限（点）：等距采样后相邻点距远小于阈值，精度损失可忽略 */
const PATH_TRACK_MAX_POINTS = 200

/** 包围盒缓冲（度）：约 220m > 相似度阈值，盒外点无需逐点算距离即可判超阈值 */
const PATH_BBOX_BUFFER_DEGREES = 0.002

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

  /** 赛段完整轨迹（GPX 导入时有值；用于路径相似度校验消除折返误匹配） */
  trackPoints?: readonly (readonly [number, number])[]
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
 * 等距抽稀轨迹：点数超上限时均匀采样（保留首末点）。
 *
 * 仅用于路径校验的「距离是否超阈值」粗判：抽稀到 200 点时相邻样点间距
 * （10km 轨迹约 50m）远小于 100m 判定阈值，中位数结果不受影响。
 * 展示层（迷你地图）仍使用完整轨迹，不受抽稀影响。
 *
 * @param trackPoints 原始轨迹
 * @param maxPoints 抽稀上限
 * @returns 抽稀后轨迹（不超上限时原样返回）
 */
function thinTrackPoints(
  trackPoints: readonly (readonly [number, number])[],
  maxPoints: number,
): readonly (readonly [number, number])[] {
  if (trackPoints.length <= maxPoints) {
    return trackPoints
  }
  const thinned: [number, number][] = []
  const step = (trackPoints.length - 1) / (maxPoints - 1)
  for (let i = 0; i < maxPoints; i += 1) {
    thinned.push(trackPoints[Math.round(i * step)] as [number, number])
  }
  return thinned
}

/**
 * 轨迹包围盒（含缓冲）。活动点在盒外时到轨迹最近距离必然超过相似度阈值，
 * 无需进入双重循环计算 haversine。
 *
 * @param trackPoints 轨迹点
 * @returns 各边界的最小/最大经纬度（含 PATH_BBOX_BUFFER_DEGREES 缓冲）
 */
function trackBoundsWithBuffer(trackPoints: readonly (readonly [number, number])[]): {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
} {
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  for (const [lat, lng] of trackPoints) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return {
    minLat: minLat - PATH_BBOX_BUFFER_DEGREES,
    maxLat: maxLat + PATH_BBOX_BUFFER_DEGREES,
    minLng: minLng - PATH_BBOX_BUFFER_DEGREES,
    maxLng: maxLng + PATH_BBOX_BUFFER_DEGREES,
  }
}

/**
 * 路径校验：赛段带完整轨迹时，检查活动轨迹与赛段轨迹的路径相似度。
 *
 * 对活动轨迹中进入起点圆到进入终点圆之间的每个 GPS 点，
 * 计算到赛段轨迹的最近距离；中位数超过阈值则判定为「路径不重合」
 * （例如盘山路折返：起终点圆距离近但实际路径完全不同）。
 *
 * 复杂度控制（GPX 导入卡死修复）：
 * 1. 包围盒预筛——盒外活动点直接记超阈值，跳过双重循环；
 * 2. 赛段轨迹抽稀至 ≤200 点——内层循环常数从数千降到 200；
 * 3. 中位数提前退出——超阈值点数过半即可判定失败，最坏也只扫一遍。
 *
 * @param trackPoints 赛段完整轨迹（[纬度, 经度] 数组）
 * @param records 活动逐点记录（已截取起点圆到终点圆之间）
 * @returns 路径重合返回 true；点数不足或赛段轨迹过短返回 true（退化为仅圆匹配）
 */
function trackMatchesPath(
  trackPoints: readonly (readonly [number, number])[],
  records: readonly ActivityRecord[],
): boolean {
  if (trackPoints.length < 3) {
    return true
  }
  const gpsRecords = records.filter(
    (record) => record.latitude !== undefined && record.longitude !== undefined,
  )
  if (gpsRecords.length < 3) {
    return true
  }

  const thinned = thinTrackPoints(trackPoints, PATH_TRACK_MAX_POINTS)
  const bounds = trackBoundsWithBuffer(thinned)

  // 中位数判定等价计数：排序后 median = distances[floor(n/2)]，
  // median > 阈值 ⟺ 至少 n - floor(n/2) 个点超阈值 → 满足即提前返回 false
  const total = gpsRecords.length
  const medianIndex = Math.floor(total / 2)
  const beyondNeeded = total - medianIndex
  let beyondCount = 0

  for (const record of gpsRecords) {
    const lat = record.latitude!
    const lng = record.longitude!
    if (
      lat < bounds.minLat ||
      lat > bounds.maxLat ||
      lng < bounds.minLng ||
      lng > bounds.maxLng
    ) {
      beyondCount += 1
    } else {
      let minDistance = Number.POSITIVE_INFINITY
      for (const [segLat, segLng] of thinned) {
        const d = haversineMeters({ latitude: lat, longitude: lng }, { latitude: segLat, longitude: segLng })
        if (d < minDistance) {
          minDistance = d
        }
      }
      if (minDistance > PATH_SIMILARITY_THRESHOLD_METERS) {
        beyondCount += 1
      }
    }
    if (beyondCount >= beyondNeeded) {
      return false
    }
  }
  return true
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
 * 性能：同一穿越段（计时起点 → 完赛点）的路径校验结果以时间段为 key 缓存，
 * 盘山路折返场景反复撞终点圆时同一窗口只计算一次。
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

  // 同一穿越段路径校验缓存：key = "startTimestamp-endTimestamp"
  const pathCheckCache = new Map<string, boolean>()

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
      // 路径校验：截取起点圆到终点圆之间的记录，检查与赛段轨迹的相似度。
      // 同一穿越段只校验一次（缓存命中直接复用）；不带轨迹的赛段跳过校验。
      const cacheKey = `${startTimestamp}-${record.timestamp}`
      let pathMatches = pathCheckCache.get(cacheKey)
      if (pathMatches === undefined && segment.trackPoints !== undefined) {
        const between = records.filter(
          (r) => r.latitude !== undefined && r.longitude !== undefined &&
                 r.timestamp >= startTimestamp! && r.timestamp <= record.timestamp,
        )
        pathMatches = trackMatchesPath(segment.trackPoints, between)
        pathCheckCache.set(cacheKey, pathMatches)
      }
      if (segment.trackPoints === undefined || pathMatches === true) {
        const duration = record.timestamp - startTimestamp
        if (best === undefined || duration < best) {
          best = duration
        }
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
