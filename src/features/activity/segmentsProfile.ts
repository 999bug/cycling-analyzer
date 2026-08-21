/**
 * 爬坡剖面数据构建（纯函数，供 SegmentsSection 的 Recharts 图表消费）。
 *
 * 职责：抽稀剖面点 → 相邻段坡度按距离窗口平滑（压掉海拔量化噪声）→
 * 坡度分档着色字段（每档一条 Line，alt0-4）→ 每个剖面点归属分段下标
 * （Tooltip 展示分段详情）→ UCI 级别徽章锚点（段内峰值剖面点）。
 * 与 UI 无关，便于单测。
 */
import type { ActivityRecord } from '@/types/activity'
import { simplifyRoute } from '@/map/simplify'
import { uciCategory, type UciCategory } from '@/features/activity/climbs'
import type { RideSegment } from '@/features/activity/segments'

/** 剖面抽稀阈值（米）：图表展示，粗抽稀即可 */
const PROFILE_SIMPLIFY_METERS = 5

/** 剖面点数上限：超出时均匀抽稀到图表像素级密度（~800px 宽）。
 *  渲染与每次重渲染的开销都和点数成正比，山路骑行 DP 抽稀后仍可能上千点 */
export const MAX_PROFILE_POINTS = 800

/** 坡度平滑窗口（米）：按距离窗口平均坡度，压掉海拔量化噪声 */
const GRADE_WINDOW_METERS = 60

/** 坡度着色分档（Strava 坡度洞察配色）：下坡蓝 → 平路绿 → 缓坡黄 → 中坡橙 → 陡坡红 */
export interface GradeBand {
  /** 分档坡度上限（%，含）；最后一档 Infinity */
  max: number

  /** 该档折线颜色 */
  color: string

  /** 图例名 */
  label: string
}

/** 坡度分档表（长度固定 5，对应剖面点字段 alt0-alt4） */
export const GRADE_BANDS: ReadonlyArray<GradeBand> = [
  { max: -2, color: '#3b82f6', label: '下坡' },
  { max: 1, color: '#22c55e', label: '平路' },
  { max: 3, color: '#eab308', label: '缓坡' },
  { max: 6, color: '#f97316', label: '中坡' },
  { max: Infinity, color: '#ef4444', label: '陡坡' },
]

/**
 * 坡度 → 分档下标（对应 GRADE_BANDS 与剖面点字段 alt{下标}）。
 *
 * @param grade 坡度（百分比）
 * @returns 分档下标（0 = 下坡 … 4 = 陡坡）
 */
export function gradeBandIndex(grade: number): number {
  const index = GRADE_BANDS.findIndex((band) => grade <= band.max)
  return index >= 0 ? index : GRADE_BANDS.length - 1
}

/** 剖面点（Recharts 数据行：x = 累计距离，y 取各坡度分档字段） */
export interface SegmentProfilePoint {
  /** 累计距离（米，X 轴） */
  x: number

  /** 海拔（米，Y 轴） */
  altitude: number

  /** 原始时间戳（Unix 秒，共享时间轴匹配用） */
  timestamp: number

  /** 所属分段下标（Tooltip 分段详情 / 色带高亮用） */
  segmentIndex: number

  /** 此处坡度（%，窗口平滑；末点沿用前一段坡度） */
  grade: number

  /** 下坡档海拔（undefined = 该点不属于此档线段） */
  alt0?: number

  /** 平路档海拔 */
  alt1?: number

  /** 缓坡档海拔 */
  alt2?: number

  /** 中坡档海拔 */
  alt3?: number

  /** 陡坡档海拔 */
  alt4?: number
}

/** UCI 级别徽章锚点（爬坡段内峰值剖面点处） */
export interface SegmentProfileBadge {
  /** 对应分段下标（key） */
  segmentIndex: number

  /** 坡级 */
  level: UciCategory

  /** 锚点距离（米，X 轴） */
  x: number

  /** 锚点海拔（米，Y 轴） */
  y: number
}

/** 剖面数据（points 供 ComposedChart data，badges 供 ReferenceDot） */
export interface SegmentProfile {
  points: SegmentProfilePoint[]
  badges: SegmentProfileBadge[]
}

/**
 * 距离对应的分段下标（整条路线连续分段，通常直接命中）。
 *
 * @param segments 全部分段
 * @param distance 距离（米）
 * @returns 分段下标；空列表时 undefined
 */
export function segmentIndexAtDistance(
  segments: readonly RideSegment[],
  distance: number,
): number | undefined {
  if (segments.length === 0) {
    return undefined
  }
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (distance >= segment.startDistanceMeters && distance <= segment.endDistanceMeters) {
      return index
    }
  }
  // 距离落在分段边界外（浮点余隙）：取最近分段
  let bestIndex = 0
  let bestDiff = Infinity
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    const diff = Math.min(
      Math.abs(distance - segment.startDistanceMeters),
      Math.abs(distance - segment.endDistanceMeters),
    )
    if (diff < bestDiff) {
      bestDiff = diff
      bestIndex = index
    }
  }
  return bestIndex
}

/**
 * 均匀抽稀到上限点数（保留首尾，等步长采样）。
 *
 * @param points 已抽稀的剖面点（升序）
 * @param maxPoints 目标点数上限（≥ 2 才有意义）
 * @returns 均匀采样后的点列表（不超上限时原样返回）
 */
function uniformSample<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints || maxPoints < 2) {
    return points
  }
  const step = (points.length - 1) / (maxPoints - 1)
  const sampled: T[] = []
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(points[Math.round(i * step)])
  }
  return sampled
}

/**
 * 构建爬坡剖面数据。
 *
 * @param records 逐点记录（含海拔/距离/坐标）
 * @param segments 平路/爬坡连续分段（buildSegments 产物）
 * @returns 剖面数据；有效剖面点不足 2 个时 null（调用方不渲染剖面）
 */
export function buildSegmentProfile(
  records: readonly ActivityRecord[],
  segments: readonly RideSegment[],
): SegmentProfile | null {
  // 抽稀 + 过滤无海拔/距离的点（需带坐标才会被 simplifyRoute 保留）
  const simplified = uniformSample(
    simplifyRoute(records, PROFILE_SIMPLIFY_METERS).filter(
      (point) => point.altitude !== undefined && point.distance !== undefined,
    ),
    MAX_PROFILE_POINTS,
  )
  if (simplified.length < 2) {
    return null
  }

  const points: SegmentProfilePoint[] = simplified.map((point) => ({
    x: point.distance as number,
    altitude: point.altitude as number,
    timestamp: point.timestamp,
    segmentIndex: segmentIndexAtDistance(segments, point.distance as number) ?? 0,
    grade: 0,
  }))

  // 相邻点坡度（按距离窗口平滑，压掉海拔量化噪声）；窗口无样本时退化为直接坡度
  const grades: number[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    const mid = (a.x + b.x) / 2
    const half = GRADE_WINDOW_METERS / 2
    let firstAlt: number | undefined
    let lastAlt = 0
    let lastDist = 0
    for (const point of points) {
      if (point.x < mid - half) {
        continue
      }
      if (point.x > mid + half) {
        break
      }
      if (firstAlt === undefined) {
        firstAlt = point.altitude
      }
      lastAlt = point.altitude
      lastDist = point.x
    }
    if (firstAlt !== undefined && lastDist - a.x > 0) {
      grades.push(((lastAlt - firstAlt) / (lastDist - a.x)) * 100)
    } else {
      const dDist = b.x - a.x
      grades.push(dDist > 0 ? ((b.altitude - a.altitude) / dDist) * 100 : 0)
    }
  }

  // 每段坡度 → 分档着色：段两端点都写该档海拔字段，相邻档线段在边界点衔接
  for (let i = 0; i + 1 < points.length; i++) {
    const bandIndex = gradeBandIndex(grades[i])
    const field = `alt${bandIndex}` as 'alt0' | 'alt1' | 'alt2' | 'alt3' | 'alt4'
    points[i][field] = points[i].altitude
    points[i + 1][field] = points[i + 1].altitude
    points[i].grade = grades[i]
  }
  // 末点坡度沿用前一段（展示用）
  points[points.length - 1].grade = grades[grades.length - 1] ?? 0

  // UCI 级别徽章：爬坡段缺失级别不渲染；锚点为段内最高海拔点
  const badges: SegmentProfileBadge[] = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment.type !== 'climb') {
      continue
    }
    const level = uciCategory(segment.distanceMeters, segment.avgGradePercent)
    if (level === null) {
      continue
    }
    let peak: SegmentProfilePoint | null = null
    for (const point of points) {
      if (point.x < segment.startDistanceMeters - 1 || point.x > segment.endDistanceMeters + 1) {
        continue
      }
      if (peak === null || point.altitude > peak.altitude) {
        peak = point
      }
    }
    if (peak !== null) {
      badges.push({ segmentIndex: index, level, x: peak.x, y: peak.altitude })
    }
  }

  return { points, badges }
}
