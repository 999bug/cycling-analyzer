/**
 * 轨迹分段着色（规格 §16）。
 *
 * 将轨迹按指标（速度/心率/功率/海拔）拆分为相邻两点间的连续线段，
 * 每条线段按指标值域映射为运动色阶（低→高：蓝→青→绿→黄→红）。
 * 纯函数模块，不依赖 React / Leaflet，便于单测。
 */
import type { RoutePoint } from '@/types/activity'

/**
 * 着色指标模式。
 */
export type ColoringMode = 'speed' | 'heartRate' | 'power' | 'altitude'

/**
 * 着色线段：相邻两点一段，含指标值与映射颜色。
 */
export interface ColoredSegment {
  /** 段起点纬度 */
  lat1: number

  /** 段起点经度 */
  lng1: number

  /** 段终点纬度 */
  lat2: number

  /** 段终点经度 */
  lng2: number

  /** 段指标值（优先取起点值，起点缺失时取终点值） */
  value: number

  /** 指标值映射的颜色 */
  color: string
}

/**
 * 着色折线：一段或多段连续坐标（同色相邻段合并，供分桶渲染用）。
 */
export interface ColoredLine {
  /** 折线颜色 */
  color: string

  /** 坐标序列（[纬度, 经度]） */
  positions: Array<[number, number]>
}

/** 色阶端点色相（度）：蓝（低值端） */
const HUE_START = 220

/** 色阶端点色相（度）：红（高值端） */
const HUE_END = 0

/** 色阶饱和度（百分比） */
const SATURATION_PERCENT = 90

/** 色阶亮度（百分比） */
const LIGHTNESS_PERCENT = 50

/**
 * 速度固定色阶域（m/s）：0 到 54 km/h，覆盖骑行常见区间。
 * 速度有物理下界 0，固定域保证不同活动之间同一颜色代表同一水平。
 */
const SPEED_RANGE: [number, number] = [0, 15]

/**
 * 心率固定色阶域（bpm）：静息到常见最大心率，生理边界明确。
 */
const HEART_RATE_RANGE: [number, number] = [60, 200]

/**
 * 功率固定色阶域（W）：休闲到业余竞技的常见区间。
 */
const POWER_RANGE: [number, number] = [0, 400]

/**
 * 数值夹到 [0, 1]。
 *
 * @param value 输入值
 * @returns 夹取后的值
 */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * 色阶函数：t∈[0,1] 映射为颜色字符串。
 */
type ColorRamp = (t: number) => string

/**
 * 运动色阶：色相从蓝（220°）线性过渡到红（0°），
 * 依次经过青（180°）、绿（120°）、黄（60°）。
 *
 * @param t 归一化指标值（夹在 [0,1]）
 * @returns CSS 颜色字符串（hsl）
 */
function jetRamp(t: number): string {
  const ratio = clamp01(t)
  const hue = Math.round(HUE_END + (1 - ratio) * (HUE_START - HUE_END))
  return `hsl(${hue}, ${SATURATION_PERCENT}%, ${LIGHTNESS_PERCENT}%)`
}

/**
 * 各模式色阶：目前统一使用运动色阶，保留按模式扩展入口。
 */
const COLOR_RAMPS: Record<ColoringMode, ColorRamp> = {
  speed: jetRamp,
  heartRate: jetRamp,
  power: jetRamp,
  altitude: jetRamp,
}

/** 图例渐变停点：与 jetRamp 同源采样，保证图例与轨迹颜色严格一致 */
const LEGEND_GRADIENT_STOPS: readonly number[] = [0, 0.25, 0.5, 0.75, 1]

/**
 * 着色图例的 CSS 渐变（linear-gradient，左低右高）。
 * 由 jetRamp 采样生成，修改色阶时图例自动跟随，不会漂移。
 */
export const COLORING_LEGEND_GRADIENT = `linear-gradient(to right, ${LEGEND_GRADIENT_STOPS.map(
  (t) => `${jetRamp(t)} ${t * 100}%`,
).join(', ')})`

/**
 * 读取点的指标值。
 *
 * @param point 轨迹点
 * @param mode 着色模式
 * @returns 指标值；该点无此指标时为 undefined
 */
export function getMetricValue(point: RoutePoint, mode: ColoringMode): number | undefined {
  switch (mode) {
    case 'speed':
      return point.speed
    case 'heartRate':
      return point.heartRate
    case 'power':
      return point.power
    case 'altitude':
      return point.altitude
  }
}

/**
 * 计算指标色阶值域。
 *
 * 速度/心率/功率使用固定域：这些指标有物理或生理边界，
 * 固定域保证不同活动之间同一颜色代表同一水平，且不受单个
 * 异常点（GPS 噪声等）影响。海拔无通用固定域（平原与山地
 * 差异巨大），使用数据 min-max 才能展示路线的高低变化。
 *
 * @param points 轨迹点
 * @param mode 着色模式
 * @returns 值域 { min, max }
 */
export function getValueRange(
  points: readonly RoutePoint[],
  mode: ColoringMode,
): { min: number; max: number } {
  switch (mode) {
    case 'speed':
      return { min: SPEED_RANGE[0], max: SPEED_RANGE[1] }
    case 'heartRate':
      return { min: HEART_RATE_RANGE[0], max: HEART_RATE_RANGE[1] }
    case 'power':
      return { min: POWER_RANGE[0], max: POWER_RANGE[1] }
    case 'altitude':
      return altitudeRange(points)
  }
}

/**
 * 海拔数据值域：忽略缺失点；无有效数据时返回 [0, 0]。
 * min 等于 max 时色阶取中段色，避免除零。
 *
 * @param points 轨迹点
 * @returns 值域 { min, max }
 */
function altitudeRange(points: readonly RoutePoint[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const point of points) {
    const value = point.altitude
    if (value === undefined) {
      continue
    }
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
  }
  if (min === Infinity) {
    return { min: 0, max: 0 }
  }
  return { min, max }
}

/**
 * 指标值映射为色阶颜色（规格 §16）。
 *
 * @param value 指标值（超出值域时夹到端点色）
 * @param mode 着色模式（决定色阶）
 * @param min 色阶值域下限
 * @param max 色阶值域上限
 * @returns CSS 颜色字符串
 */
export function getColorForValue(value: number, mode: ColoringMode, min: number, max: number): string {
  const ramp = COLOR_RAMPS[mode]
  if (max === min) {
    // 全同值：取色阶中段色，避免除零
    return ramp(0.5)
  }
  return ramp((value - min) / (max - min))
}

/**
 * 将轨迹拆分为着色线段（规格 §16）。
 *
 * 相邻两点成一段；段值优先取起点指标值，起点缺失时取终点值，
 * 两端均缺失的段跳过（无数据处不着色，避免被误读为低值）。
 *
 * @param points 轨迹点（抽稀后）
 * @param mode 着色模式
 * @returns 着色线段列表（按原顺序；不足 2 点或无可着色段时为空数组）
 */
export function buildSegments(points: readonly RoutePoint[], mode: ColoringMode): ColoredSegment[] {
  const { min, max } = getValueRange(points, mode)
  const segments: ColoredSegment[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const first = points[i]
    const second = points[i + 1]
    const value = getMetricValue(first, mode) ?? getMetricValue(second, mode)
    if (value === undefined) {
      continue
    }
    segments.push({
      lat1: first.latitude,
      lng1: first.longitude,
      lat2: second.latitude,
      lng2: second.longitude,
      value,
      color: getColorForValue(value, mode, min, max),
    })
  }
  return segments
}

/** 分桶渲染默认桶数 */
export const DEFAULT_BUCKET_COUNT = 8

/**
 * 分桶合并为着色折线（大段数性能优化）。
 *
 * 将指标值域等分为 bucketCount 个桶，同桶且相邻的段合并为一条
 * 折线（每桶一条 Polyline），使 Leaflet 渲染的图层数从段数量级
 * 降到桶数量级；不同桶之间或缺失值断开处自动分割为多条折线。
 *
 * @param points 轨迹点
 * @param mode 着色模式
 * @param bucketCount 桶数（值域等分数）
 * @returns 着色折线列表（按原顺序）
 */
export function buildBucketLines(
  points: readonly RoutePoint[],
  mode: ColoringMode,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): ColoredLine[] {
  const { min, max } = getValueRange(points, mode)
  const span = max - min
  const lines: ColoredLine[] = []
  let current: ColoredLine | undefined
  for (let i = 0; i + 1 < points.length; i++) {
    const first = points[i]
    const second = points[i + 1]
    const value = getMetricValue(first, mode) ?? getMetricValue(second, mode)
    if (value === undefined) {
      // 无数据处断开当前折线，后续有值段重新起线
      current = undefined
      continue
    }
    const ratio = span === 0 ? 0 : clamp01((value - min) / span)
    const bucket = Math.min(bucketCount - 1, Math.floor(ratio * bucketCount))
    // 桶中心值作为代表值着色，保证桶内颜色一致
    const bucketValue = span === 0 ? min : min + ((bucket + 0.5) * span) / bucketCount
    const color = getColorForValue(bucketValue, mode, min, max)
    if (current !== undefined && current.color === color) {
      current.positions.push([second.latitude, second.longitude])
    } else {
      current = {
        color,
        positions: [
          [first.latitude, first.longitude],
          [second.latitude, second.longitude],
        ],
      }
      lines.push(current)
    }
  }
  return lines
}
