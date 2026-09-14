/**
 * 地图框选建段纯函数（赛段重设计二期）。
 *
 * 从活动逐点记录上取两个索引截取路段：时间序在前的为计时起点
 * （先选终点再选起点 = 反向赛段，等价于交换两圆），轨迹切片存入
 * trackPoints 供路径校验与距离展示。
 *
 * 坐标口径：与「设为赛段」及匹配器一致，存储**原始记录坐标**
 * （不做坐标系转换）——匹配时活动 records 也是原始坐标，两者同口径；
 * 展示层由 SegmentMiniMap 按既有逻辑投影。
 */
import type { ActivityRecord } from '@/types/activity'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 框选结果草稿（入库前由弹窗补 name/createdAt/sourceActivityId） */
export interface SegmentDraft {
  /** 起点（计时起点）圆心，原始记录坐标 */
  startLatitude: number
  startLongitude: number

  /** 终点圆心，原始记录坐标 */
  endLatitude: number
  endLongitude: number

  /** 截取路段轨迹切片（原始坐标 [纬度, 经度]，含首尾） */
  trackPoints: [number, number][]

  /** 路段路径距离（米，相邻点 haversine 累加） */
  distanceMeters: number

  /** 选取方向：forward = 按骑行时间正序（先选的点在时间上在前） */
  direction: 'forward' | 'reverse'
}

/**
 * 找到距目标坐标最近的带坐标记录索引。
 *
 * @param records 完整逐点数据
 * @param latitude 目标纬度（原始坐标系）
 * @param longitude 目标经度
 * @returns 最近点索引；无坐标记录返回 undefined
 */
export function nearestRecordIndex(
  records: readonly ActivityRecord[],
  latitude: number,
  longitude: number,
): number | undefined {
  let bestIndex: number | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (record?.latitude === undefined || record?.longitude === undefined) {
      continue
    }
    const distance = haversineMeters(
      { latitude, longitude },
      { latitude: record.latitude, longitude: record.longitude },
    )
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * 由两个框选索引构造赛段草稿。
 *
 * @param records 完整逐点数据
 * @param firstIndex 第一次点击的记录索引
 * @param secondIndex 第二次点击的记录索引
 * @returns 赛段草稿；任一索引无坐标时返回 undefined
 */
export function buildSegmentDraft(
  records: readonly ActivityRecord[],
  firstIndex: number,
  secondIndex: number,
): SegmentDraft | undefined {
  const first = records[firstIndex]
  const second = records[secondIndex]
  if (
    first === undefined ||
    second === undefined ||
    first.latitude === undefined ||
    first.longitude === undefined ||
    second.latitude === undefined ||
    second.longitude === undefined
  ) {
    return undefined
  }

  // 时间序归一：startIndex 恒在前；用户反向选取 = 反向赛段
  const forward = firstIndex < secondIndex
  const startIndex = forward ? firstIndex : secondIndex
  const endIndex = forward ? secondIndex : firstIndex

  const trackPoints: [number, number][] = []
  let distanceMeters = 0
  let previous: { latitude: number; longitude: number } | undefined
  for (let i = startIndex; i <= endIndex; i += 1) {
    const record = records[i]
    if (record?.latitude === undefined || record?.longitude === undefined) {
      continue
    }
    trackPoints.push([record.latitude, record.longitude])
    if (previous !== undefined) {
      distanceMeters += haversineMeters(previous, {
        latitude: record.latitude,
        longitude: record.longitude,
      })
    }
    previous = { latitude: record.latitude, longitude: record.longitude }
  }

  return {
    startLatitude: trackPoints[0]?.[0] ?? first.latitude,
    startLongitude: trackPoints[0]?.[1] ?? first.longitude,
    endLatitude: trackPoints[trackPoints.length - 1]?.[0] ?? second.latitude,
    endLongitude: trackPoints[trackPoints.length - 1]?.[1] ?? second.longitude,
    trackPoints,
    distanceMeters,
    direction: forward ? 'forward' : 'reverse',
  }
}

/**
 * 判断一次穿越与草稿的方向一致性：穿越窗口首末 GPS 点的净位移
 * 与「起点 → 终点」方向的点积为正 = 正向。
 *
 * @param segment 赛段几何（起终点圆心）
 * @param records 穿越活动逐点数据
 * @param startTimestamp 穿越计时起点（Unix 秒）
 * @param endTimestamp 完赛点（Unix 秒）
 * @returns true = 正向；无足够 GPS 点返回 undefined
 */
export function effortMatchesDirection(
  segment: { startLatitude: number; startLongitude: number; endLatitude: number; endLongitude: number },
  records: readonly ActivityRecord[],
  startTimestamp: number,
  endTimestamp: number,
): boolean | undefined {
  let first: { latitude: number; longitude: number } | undefined
  let last: { latitude: number; longitude: number } | undefined
  for (const record of records) {
    if (record.latitude === undefined || record.longitude === undefined) {
      continue
    }
    if (record.timestamp < startTimestamp || record.timestamp > endTimestamp) {
      continue
    }
    if (first === undefined) {
      first = { latitude: record.latitude, longitude: record.longitude }
    }
    last = { latitude: record.latitude, longitude: record.longitude }
  }
  if (first === undefined || last === undefined) {
    return undefined
  }
  const segLat = segment.endLatitude - segment.startLatitude
  const segLng = segment.endLongitude - segment.startLongitude
  const moveLat = last.latitude - first.latitude
  const moveLng = last.longitude - first.longitude
  return segLat * moveLat + segLng * moveLng > 0
}
