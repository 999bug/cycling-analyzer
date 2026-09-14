/**
 * 赛段统计纯函数：距离口径统一（活动页「本次赛段」与赛段详情页共用）。
 *
 * 有轨迹点（GPX 导入 / 作者快照带轨迹）按相邻点 haversine 距离累加得真实路径长；
 * 仅起终点圆的赛段退化为直线距离（真实路径 ≥ 直线，展示时标注「直线」避免误导）。
 */
import type { SegmentGeometry, SegmentEffort } from '@/features/segments/segmentMatching'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 近 90 天传奇窗口（毫秒） */
const LEGEND_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

/**
 * 计算赛段成就三档（纯函数，SegmentAchievements 组件与测试共用）：
 * - recordSegments：握有个人最好成绩的赛段数（有成绩的赛段数）；
 * - podiumEfforts：进入各赛段前三的成绩数（每赛段封顶 3）；
 * - legend：近 90 天完成次数最多的赛段（无近 90 天成绩为 null）。
 *
 * @param leaderboards 各赛段成绩榜（key = 赛段 id）
 * @returns 成就三档
 */
export function computeSegmentAchievements(leaderboards: ReadonlyMap<number, SegmentEffort[]>): {
  recordSegments: number
  podiumEfforts: number
  legend: { segmentId: number; count: number } | null
} {
  let recordSegments = 0
  let podiumEfforts = 0
  let legend: { segmentId: number; count: number } | null = null
  const since = Date.now() - LEGEND_WINDOW_MS

  for (const [segmentId, efforts] of leaderboards) {
    if (efforts.length === 0) {
      continue
    }
    recordSegments += 1
    podiumEfforts += Math.min(3, efforts.length)
    const recentCount = efforts.filter(
      (effort) => new Date(effort.startTime).getTime() >= since,
    ).length
    if (recentCount > 0 && (legend === null || recentCount > legend.count)) {
      legend = { segmentId, count: recentCount }
    }
  }
  return { recordSegments, podiumEfforts, legend }
}

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
