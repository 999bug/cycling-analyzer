/**
 * 轨迹抽稀（规格 §12）：Douglas-Peucker 算法。
 *
 * 将逐点记录中带坐标的点按距离阈值抽稀，保留轨迹形状的同时
 * 大幅减少绘图点数（FIT 逐点数据动辄数千点，全量绘制卡顿）。
 * 距离计算采用局部等距投影（近似球面），tolerance 单位为米。
 */
import type { ActivityRecord, RoutePoint } from '@/types/activity'

/**
 * 抽稀轨迹点：从逐点记录中提取带坐标的点，按阈值简化。
 *
 * @param points 逐点记录（无坐标的点自动剔除）
 * @param tolerance 抽稀阈值（米），点到线段距离大于此值的点保留
 * @returns 抽稀后的轨迹点（按原顺序，含首尾；无坐标点时为空数组）
 */
export function simplifyRoute(points: readonly ActivityRecord[], tolerance: number): RoutePoint[] {
  const withCoords: RoutePoint[] = []
  for (const record of points) {
    if (record.latitude !== undefined && record.longitude !== undefined) {
      withCoords.push({
        timestamp: record.timestamp,
        latitude: record.latitude,
        longitude: record.longitude,
        altitude: record.altitude,
        distance: record.distance,
        speed: record.speed,
        heartRate: record.heartRate,
        cadence: record.cadence,
        power: record.power,
      })
    }
  }
  if (withCoords.length <= 2) {
    return withCoords
  }

  // 基准纬度取两端点均值，用于经度方向的米制校正
  const lat0 = ((withCoords[0].latitude + withCoords[withCoords.length - 1].latitude) / 2) * DEG_TO_RAD
  const keepIndexes = simplifyDp(withCoords, tolerance, lat0)
  return keepIndexes.map((index) => withCoords[index])
}

/** 度转弧度 */
const DEG_TO_RAD = Math.PI / 180

/**
 * 地球平均半径（米）。
 * 注意：投影使用「弧度 × 半径」而非「度 × 每度米数」，
 * 两者混用会引入约 57 倍的距离误差（曾导致抽稀过度）。
 */
const EARTH_RADIUS_METERS = 6_371_000

/**
 * 将经纬度投影为局部平面坐标（米，等距方位投影近似）。
 * 经度方向按基准纬度余弦校正，局部范围内近似度足够抽稀使用。
 *
 * @param point 轨迹点
 * @param lat0 基准纬度（弧度）
 * @returns 平面坐标 [x, y]（米）
 */
function project(point: RoutePoint, lat0: number): [number, number] {
  const x = point.longitude * DEG_TO_RAD * Math.cos(lat0) * EARTH_RADIUS_METERS
  const y = point.latitude * DEG_TO_RAD * EARTH_RADIUS_METERS
  return [x, y]
}

/**
 * Douglas-Peucker 核心：迭代栈实现（避免递归栈溢出）。
 * 对每条候选线段找垂直距离最大的点，超过阈值则保留并递归分割两侧。
 *
 * @param points 轨迹点（已含坐标）
 * @param tolerance 抽稀阈值（米）
 * @param lat0 基准纬度（弧度）
 * @returns 保留点的索引列表（升序）
 */
function simplifyDp(points: RoutePoint[], tolerance: number, lat0: number): number[] {
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  // 栈元素为线段两端索引 [first, last]
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    const [ax, ay] = project(points[first], lat0)
    const [bx, by] = project(points[last], lat0)

    let maxDistance = 0
    let pivot = -1
    for (let i = first + 1; i < last; i++) {
      const [px, py] = project(points[i], lat0)
      const distance = perpendicularDistance(px, py, ax, ay, bx, by)
      if (distance > maxDistance) {
        maxDistance = distance
        pivot = i
      }
    }

    if (pivot >= 0 && maxDistance > tolerance) {
      keep[pivot] = 1
      stack.push([first, pivot], [pivot, last])
    }
  }

  const result: number[] = []
  for (let i = 0; i < points.length; i++) {
    if (keep[i] === 1) {
      result.push(i)
    }
  }
  return result
}

/**
 * 点到线段（AB）的垂直距离（米）。
 * 线段退化（A、B 重合）时退化为点到端点距离。
 *
 * @param px 点 x 坐标
 * @param py 点 y 坐标
 * @param ax 线段起点 x 坐标
 * @param ay 线段起点 y 坐标
 * @param bx 线段终点 x 坐标
 * @param by 线段终点 y 坐标
 * @returns 垂直距离（米）
 */
function perpendicularDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    // 线段退化为点：距离即点到 A 的距离
    return Math.hypot(px - ax, py - ay)
  }

  // 投影参数 t 夹在 [0,1]，保证距离为到线段而非延长线
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
