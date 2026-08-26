/**
 * 在线回放纯计算模块：与 React 组件解耦（可单测、避免 fast-refresh 导出限制）。
 */

/** 轨迹点最小结构（仅回放计算所需字段） */
export interface ReplayPoint {
  /** Unix 秒时间戳 */
  timestamp: number

  /** 纬度 */
  latitude: number

  /** 经度 */
  longitude: number
}

/**
 * 计算指定时间戳对应的轨迹点索引（二分查找最近点）。
 *
 * @param points 轨迹点（timestamp 升序）
 * @param timestamp 目标时间戳
 */
export function findIndexAtTimestamp(points: ReplayPoint[], timestamp: number): number {
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid]!.timestamp < timestamp) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

/**
 * 构建已走高亮折线用的均匀抽稀骨架（保留末点，保证播完时与全程轨迹吻合）。
 *
 * @param points 全量轨迹点
 * @param maxPoints 抽稀上限点数
 */
export function buildReplaySkeleton<T extends ReplayPoint>(points: T[], maxPoints: number): T[] {
  const stride = Math.max(1, Math.ceil(points.length / maxPoints))
  if (stride === 1) {
    return points
  }
  const sampled = points.filter((_, index) => index % stride === 0)
  const last = points[points.length - 1]
  if (last !== undefined && sampled[sampled.length - 1] !== last) {
    sampled.push(last)
  }
  return sampled
}
