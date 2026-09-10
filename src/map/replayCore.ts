/**
 * 在线回放纯计算模块：与 React 组件解耦（可单测、避免 fast-refresh 导出限制）。
 */
import { isMovingSegment } from '@/features/activity/movingTime'
import { haversineMeters } from '@/charts/timeline'

/** 轨迹点最小结构（仅回放计算所需字段） */
export interface ReplayPoint {
  /** Unix 秒时间戳 */
  timestamp: number

  /** 纬度 */
  latitude: number

  /** 经度 */
  longitude: number
}

/** 时间轴压缩的输入点：时间戳 + 累计距离（判定位移用）+ 可选坐标（限速用） */
export interface MovingTimelineInput {
  /** Unix 秒时间戳（升序） */
  timestamp: number

  /** 累计距离（米）；全部缺失时无法判定暂停，时间轴原样返回 */
  distance?: number

  /** 纬度；与 longitude 同时存在时可参与「光标限速」补时 */
  latitude?: number

  /** 经度；与 latitude 同时存在时可参与「光标限速」补时 */
  longitude?: number
}

/**
 * 回放光标的最大等效速度（m/s，90km/h）：高于任何真实骑行速度。
 *
 * 用途：设备停记/丢 GPS 期间骑出去的距离，会落在「一个记录缺口 = 判定为暂停」的
 * 段里被折成 0 时长，光标于是瞬间跨越数百米（实测最大 3153m）。把这些段的时长
 * 补足到「按该速度走完所需时间」即可让光标平滑滑过，而不是跳过去。
 * 取值高于真实骑行速度，因此正常骑行段永远不会被补时。
 *
 * 导出以便 scripts/check-replay-timeline.ts 用同一阈值做真实数据回归。
 */
export const MAX_CURSOR_SPEED_MPS = 25

/**
 * 单段时钟增量：以运动时长为下限、该段真实间隔为上限，位移过大时补足到限速所需时长。
 *
 * 上限保证「回放总时长 ≤ 活动总耗时」——GPS 抖出的假位移不会把回放拉长到失控。
 *
 * @param movingTime 该段的运动时长（密集记录判定结果，秒）
 * @param prev 段起点（含原始时间戳；有坐标时限速生效）
 * @param curr 段终点
 */
function segmentClockDelta(movingTime: number, prev: MovingTimelineInput, curr: MovingTimelineInput): number {
  const realDt = Math.max(curr.timestamp - prev.timestamp, 0)
  if (
    prev.latitude === undefined || prev.longitude === undefined
    || curr.latitude === undefined || curr.longitude === undefined
  ) {
    return movingTime
  }
  const needed = haversineMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude) / MAX_CURSOR_SPEED_MPS
  return Math.min(Math.max(movingTime, needed), realDt)
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
 * **判定源必须与展示点分开传**（`motionSource`）：详情页展示用的是 Douglas-Peucker
 * 抽稀点，采样间隔可达分钟级——直接把「>60s 缺口 = 暂停」套在抽稀点上，会把
 * 正常骑行段误判成暂停并折成 0 时长，光标于是横跨数百米瞬移。传入未抽稀的
 * 密集逐点记录后，判定与活动计时时长完全同口径；抽稀点的时间戳是密集记录的
 * 子集，按时间戳查表重映射即可（两点指针同步推进，O(N+M)）。
 *
 * 兜底：点数不足、完全没有累计距离、或全程判定为静止（压缩后时长归零）时，
 * 原样返回入参数组——回退真实时间轴，行为与改造前一致。
 *
 * 光标限速：设备停记/丢 GPS 期间真骑出去的距离，会落在被判为暂停的记录缺口里被折成
 * 0 时长，光标于是瞬间跨越数百米（实测最大 3153m）。这类段按 MAX_CURSOR_SPEED_MPS
 * 补足时长，光标平滑滑过；补时上限为该段真实间隔，故回放总时长始终 ≤ 活动总耗时。
 *
 * @param points 展示用轨迹点（timestamp 升序）
 * @param motionSource 判定暂停用的密集采样源（timestamp 升序，含累计距离）；
 *   缺省时用 points 自身判定（仅适用于本身就密集的点集，如视频导出的逐点记录）
 * @returns 时间戳重映射后的新数组（不修改入参）
 */
export function buildMovingTimeline<T extends MovingTimelineInput>(
  points: T[],
  motionSource?: readonly MovingTimelineInput[],
): T[] {
  const first = points[0]
  const source = motionSource ?? points
  if (first === undefined || points.length < 2 || source.length < 2) {
    return points
  }
  if (!source.some((point) => point.distance !== undefined)) {
    return points
  }
  const timeline: T[] = []
  let movingClock = 0
  // 判定源指针：推进到「不在展示点之后」为止，把中间各运动段的时长累进 pendingMovingTime
  let cursor = 0
  let prevPoint: T | undefined
  for (const point of points) {
    let pendingMovingTime = 0
    while (cursor + 1 < source.length && source[cursor + 1]!.timestamp <= point.timestamp) {
      const prev = source[cursor]!
      const curr = source[cursor + 1]!
      if (isMovingSegment(prev, curr)) {
        pendingMovingTime += Math.max(curr.timestamp - prev.timestamp, 0)
      }
      cursor++
    }
    movingClock += prevPoint === undefined
      ? pendingMovingTime
      : segmentClockDelta(pendingMovingTime, prevPoint, point)
    timeline.push({ ...point, timestamp: movingClock })
    prevPoint = point
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
 * 已走高亮线的两段切分点。
 *
 * 线头必须**恰好停在光标上**：骨架段若直接画到「光标所在段的右端点」，
 * 线头会比圆点领先最多一个抽稀段（实测中位 170m、最大 1km+，视觉上就是
 * 「橙线跑得比圆点快」，圆点像被甩在后面）。因此骨架只画到光标**身后**
 * 的抽稀点，剩下的一小截由末段补齐并收在光标上。
 */
export interface TraveledSplit {
  /** 骨架段应包含的抽稀点数（0 表示骨架尚未开始） */
  backboneCount: number

  /** 末段需要补的原始点起始下标（骨架尾点的下一个原始点） */
  tailStart: number
}

/**
 * 计算已走高亮线的骨架段/末段切分。
 *
 * @param pointIndex 光标所在段的右端点索引（findIndexAtTimestamp 的返回值）
 * @param stride 骨架抽稀步长
 * @param skeletonCount 骨架点数
 */
export function splitTraveledLine(
  pointIndex: number,
  stride: number,
  skeletonCount: number,
): TraveledSplit {
  if (pointIndex <= 0) {
    return { backboneCount: 0, tailStart: 0 }
  }
  // 光标位于 [pointIndex-1, pointIndex] 段内：骨架最多画到 pointIndex-1
  const backedIndex = pointIndex - 1
  const backboneCount = Math.min(skeletonCount, Math.floor(backedIndex / stride) + 1)
  if (backboneCount === 0) {
    return { backboneCount: 0, tailStart: 0 }
  }
  // 骨架尾点 = points[(backboneCount-1) * stride]，末段从它的下一个原始点接着画
  return { backboneCount, tailStart: (backboneCount - 1) * stride + 1 }
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
