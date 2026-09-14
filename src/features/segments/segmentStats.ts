/**
 * 赛段统计纯函数：距离口径统一（活动页「本次赛段」与赛段详情页共用）。
 *
 * 有轨迹点（GPX 导入 / 作者快照带轨迹）按相邻点 haversine 距离累加得真实路径长；
 * 仅起终点圆的赛段退化为直线距离（真实路径 ≥ 直线，展示时标注「直线」避免误导）。
 */
import type { SegmentGeometry } from '@/features/segments/segmentMatching'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 赛段距离（米）与是否直线估算 */
export interface SegmentDistance {
  /** 距离（米） */
  meters: number

  /** true = 起终点直线估算（赛段无轨迹点） */
  estimated: boolean
}

/**
 * 计算赛段距离。
 *
 * @param segment 赛段几何
 * @returns 距离与口径标记
 */
export function segmentDistanceMeters(segment: SegmentGeometry): SegmentDistance {
  if (segment.trackPoints !== undefined && segment.trackPoints.length >= 2) {
    let total = 0
    for (let i = 1; i < segment.trackPoints.length; i += 1) {
      total += haversineMeters(
        { latitude: segment.trackPoints[i - 1]![0], longitude: segment.trackPoints[i - 1]![1] },
        { latitude: segment.trackPoints[i]![0], longitude: segment.trackPoints[i]![1] },
      )
    }
    return { meters: total, estimated: false }
  }
  return {
    meters: haversineMeters(
      { latitude: segment.startLatitude, longitude: segment.startLongitude },
      { latitude: segment.endLatitude, longitude: segment.endLongitude },
    ),
    estimated: true,
  }
}
