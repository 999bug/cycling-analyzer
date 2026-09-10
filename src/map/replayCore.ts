/**
 * 在线回放纯计算模块：与 React 组件解耦（可单测、避免 fast-refresh 导出限制）。
 */
import { isMovingSegment } from '@/features/activity/movingTime'

/** 轨迹点最小结构（仅回放计算所需字段） */
export interface ReplayPoint {
  /** Unix 秒时间戳 */
  timestamp: number

  /** 纬度 */
  latitude: number

  /** 经度 */
  longitude: number
}

/** 时间轴压缩的输入点：时间戳 + 累计距离（判定位移用） */
export interface MovingTimelineInput {
  /** Unix 秒时间戳（升序） */
  timestamp: number

  /** 累计距离（米）；全部缺失时无法判定暂停，时间轴原样返回 */
  distance?: number
}

/**
 * 把真实时间轴压缩为「运动时间轴」：暂停（红灯/休息/记录断档）时段增量为 0。
 *
 * 动机：真实时间轴下暂停时段会一秒钟不差地播出来（1× 尤其难受——光标原地
 * 不动、时钟照走）。压缩后光标匀速穿过轨迹，回放总时长等于活动的计时时长
 * （判定规则与 @/fit/calculator 的均速分母同源，见 @/features/activity/movingTime）。
 *
 * **几何点一个不丢**（只改 timestamp）：已走高亮折线与底图完整轨迹始终重合，
 * 暂停段在时间轴上宽度为 0，因而不会被停留播放。
 *
 * 兜底：点数不足、完全没有累计距离、或全程判定为静止（压缩后时长归零）时，
 * 原样返回入参数组——回退真实时间轴，行为与改造前一致。
 *
 * @param points 轨迹点（timestamp 升序，依赖累计距离字段）
 * @returns 时间戳重映射后的新数组（不修改入参）
 */
export function buildMovingTimeline<T extends MovingTimelineInput>(points: T[]): T[] {
  const first = points[0]
  if (first === undefined || points.length < 2) {
    return points
  }
  if (!points.some((point) => point.distance !== undefined)) {
    return points
  }
  const timeline: T[] = [{ ...first, timestamp: 0 }]
  let movingClock = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    if (isMovingSegment(prev, curr)) {
      movingClock += Math.max(curr.timestamp - prev.timestamp, 0)
    }
    timeline.push({ ...curr, timestamp: movingClock })
  }
  return movingClock > 0 ? timeline : points
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

/**
 * 相邻记录点间线性插值：计算目标时刻的连续坐标。
 * 记录间隔通常为秒级，直接取最近点会逐点跳动；插值后光标以帧率平滑滑行。
 *
 * @param points 轨迹点（timestamp 升序）
 * @param index 目标时刻所在段的左端点索引（findIndexAtTimestamp 的返回值）
 * @param timestamp 目标时刻
 */
export function interpolatePositionAt(
  points: ReplayPoint[],
  index: number,
  timestamp: number,
): { latitude: number; longitude: number } {
  const current = points[Math.min(index, points.length - 1)]!
  const next = points[index + 1]
  if (next === undefined) {
    return { latitude: current.latitude, longitude: current.longitude }
  }
  const span = next.timestamp - current.timestamp
  if (span <= 0) {
    return { latitude: current.latitude, longitude: current.longitude }
  }
  const t = Math.min(Math.max((timestamp - current.timestamp) / span, 0), 1)
  return {
    latitude: current.latitude + (next.latitude - current.latitude) * t,
    longitude: current.longitude + (next.longitude - current.longitude) * t,
  }
}

/**
 * 构建光标数据牌条目文案：速度/心率/功率（缺失字段直接省略，不伪造）。
 * 全部缺失时返回空数组（调用方据此隐藏数据牌）。
 * 纯函数：在线回放（HTML）与回放视频导出（Canvas）共用同一规则。
 *
 * @param point 当前轨迹点（可为 undefined，如空轨迹兜底）
 */
export function formatCursorTipItems(
  point: { speed?: number; heartRate?: number; power?: number } | undefined,
): string[] {
  if (point === undefined) {
    return []
  }
  const items: string[] = []
  if (point.speed !== undefined) {
    items.push(`${(point.speed * 3.6).toFixed(1)} km/h`)
  }
  if (point.heartRate !== undefined) {
    items.push(`${point.heartRate} bpm`)
  }
  if (point.power !== undefined) {
    items.push(`${point.power} W`)
  }
  return items
}

/**
 * 构建光标数据牌 HTML：速度/心率/功率（缺失字段直接省略，不伪造）。
 * 全部缺失时返回空字符串（调用方据此隐藏数据牌）。
 * 纯函数：便于单测与避免 fast-refresh 导出限制。
 *
 * @param point 当前轨迹点（可为 undefined，如空轨迹兜底）
 */
export function buildCursorTipHtml(
  point: { speed?: number; heartRate?: number; power?: number } | undefined,
): string {
  return formatCursorTipItems(point)
    .map((text) => `<span class="replay-cursor-tip__item">${text}</span>`)
    .join('')
}
