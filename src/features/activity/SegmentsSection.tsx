/**
 * 爬坡与分段分析区块（合并爬坡分析 + 分段分析）。
 *
 * 顶部海拔剖面：剖面线按坡度连续着色（Strava 坡度洞察风格：下坡蓝/平路绿/缓坡黄/
 * 中坡橙/陡坡红），底下叠加平路/爬坡色带，爬坡段在峰值处打 UCI 级别徽章；
 * 下方为**全量**分段卡片（平路段 + 爬坡段，含距离/爬升/坡度/速度/功率/心率）
 * 与相邻爬坡对比洞察。
 *
 * 悬浮联动：悬停剖面更新悬停分段的色带高亮，并上报时间戳（共享时间轴联动地图/图表）；
 * 悬停分段卡片同步高亮剖面对应色带。无爬坡时区块不渲染。
 */
import { useMemo, useState } from 'react'
import { buildClimbs, uciCategory, type UciCategory } from '@/features/activity/climbs'
import {
  buildSegments,
  climbInsights,
  type RideSegment,
} from '@/features/activity/segments'
import { simplifyRoute } from '@/map/simplify'
import { formatDistanceByUnit, formatSpeedByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { ActivityRecord } from '@/types/activity'
import { findNearestByTimestamp } from '@/charts/timeline'
import { SEGMENT_BAND_COLORS as BAND_COLORS } from '@/theme/colors'
import '@/features/activity/segmentsSection.css'

/** 剖面抽稀阈值（米）——SVG 小图展示，粗抽稀即可 */
const PROFILE_SIMPLIFY_METERS = 5

/** 剖面视口（x/y 同 0-100，宽度与高度独立归一化，配合 preserveAspectRatio=none 与 HTML 徽章精确对齐） */
const PROFILE_WIDTH = 100
const PROFILE_HEIGHT = 100

/** 坡度平滑窗口（米）：按距离窗口平均坡度，压掉海拔量化噪声 */
const GRADE_WINDOW_METERS = 60

/** 悬停参考线色（主色，与地图悬停圆点呼应） */
const HOVER_LINE_COLOR = '#4f8cff'

/** 悬停圆点填充色 */
const HOVER_DOT_COLOR = '#ffffff'

/** UCI 级别色板（Strava 风格：4 级蓝 → HC 紫） */
const LEVEL_COLORS: Record<UciCategory, string> = {
  4: '#3b82f6',
  3: '#22c55e',
  2: '#f59e0b',
  1: '#ef4444',
  HC: '#a855f7',
}

/** 坡度着色分档（Strava 坡度洞察配色）：下坡蓝 → 平路绿 → 缓坡黄 → 中坡橙 → 陡坡红 */
const GRADE_COLORS: ReadonlyArray<{ max: number; color: string; label: string }> = [
  { max: -2, color: '#3b82f6', label: '下坡' },
  { max: 1, color: '#22c55e', label: '平路' },
  { max: 3, color: '#eab308', label: '缓坡' },
  { max: 6, color: '#f97316', label: '中坡' },
  { max: Infinity, color: '#ef4444', label: '陡坡' },
]

/** 剖面点（归一化到视口 + 保留原始距离/海拔/时间戳） */
interface ProfilePoint {
  /** 视口 x（0-100） */
  x: number

  /** 视口 y（0-100，越大越低） */
  y: number

  /** 累计距离（米） */
  distance: number

  /** 海拔（米） */
  altitude: number

  /** 原始时间戳（Unix 秒，共享时间轴匹配用） */
  timestamp: number
}

/** 同色折线段（一条 polyline） */
interface ColoredSegment {
  /** 颜色 */
  color: string

  /** 归一化坐标串（'x,y x,y …'） */
  points: string
}

/** 平路/爬坡色带（视口坐标 + 对应分段序号） */
interface ProfileBand {
  /** 视口 x 起点 */
  x: number

  /** 视口宽度 */
  width: number

  /** 分段类型 */
  type: 'flat' | 'climb'

  /** 对应分段在 segments 数组中的下标（悬浮联动用） */
  index: number
}

/** UCI 级别徽章（悬浮于剖面峰值处） */
interface ClimbBadge {
  /** 对应分段下标（key） */
  index: number

  /** 坡级 */
  level: UciCategory

  /** 视口 x（徽章水平居中锚点，0-100） */
  x: number

  /** 峰值视口 y（徽章顶部锚点，0-100） */
  y: number
}

/**
 * 爬坡与分段分析区块 props。
 */
export interface SegmentsSectionProps {
  /** 逐点记录（含海拔/距离/速度/功率/心率） */
  records: ActivityRecord[]

  /** 距离显示单位（距离/速度随偏好换算） */
  distanceUnit: DistanceUnit

  /** 共享时间轴：外部悬停时间戳（Unix 秒）；命中时渲染参考线 */
  hoverTimestamp?: number

  /** 悬停回调：鼠标滑过剖面时上报所在点时间戳（Unix 秒）；移出时传 undefined */
  onHover?: (timestamp: number | undefined) => void
}

/**
 * 按坡度选色。
 *
 * @param grade 坡度（百分比）
 * @returns 对应颜色
 */
function gradeColor(grade: number): string {
  return GRADE_COLORS.find((entry) => grade <= entry.max)?.color ?? GRADE_COLORS[0].color
}

/** 级别显示名 */
function levelLabel(level: UciCategory): string {
  return level === 'HC' ? 'HC' : `${level} 级`
}

/**
 * 距离开关对应的分段下标（整条路线连续分段，通常直接命中）。
 *
 * @param segments 全部分段
 * @param distance 距离（米）
 * @returns 分段下标；空列表时 undefined
 */
function segmentIndexAtDistance(
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
 * 爬坡与分段分析区块组件。
 *
 * @param props 组件参数
 */
function SegmentsSection({
  records,
  distanceUnit,
  hoverTimestamp,
  onHover,
}: SegmentsSectionProps) {
  // 悬停分段下标（undefined = 未悬停）
  const [hoverIndex, setHoverIndex] = useState<number>()
  // 本图鼠标 x（视口 0-100；undefined = 未悬停，回退外部共享时间轴）
  const [hoverX, setHoverX] = useState<number>()

  // 分段 + 洞察 + 剖面数据
  const { climbs, segments, insights, profile, climbCount, flatCount } = useMemo(() => {
    const climbs = buildClimbs(records)
    const built = buildSegments(records, climbs)
    const insights = climbInsights(built)
    const climbCount = built.filter((segment) => segment.type === 'climb').length
    const flatCount = built.filter((segment) => segment.type === 'flat').length

    // 剖面点（抽稀 + 归一化；保留 timestamp 供共享时间轴匹配）
    const simplified = simplifyRoute(records, PROFILE_SIMPLIFY_METERS).filter(
      (point) => point.altitude !== undefined && point.distance !== undefined,
    )
    if (simplified.length < 2) {
      return { climbs, segments: built, insights, profile: null, climbCount, flatCount }
    }
    let minAlt = Infinity
    let maxAlt = -Infinity
    let maxDist = 0
    for (const point of simplified) {
      const alt = point.altitude as number
      if (alt < minAlt) {
        minAlt = alt
      }
      if (alt > maxAlt) {
        maxAlt = alt
      }
      maxDist = Math.max(maxDist, point.distance as number)
    }
    const altSpan = maxAlt - minAlt || 1
    const points: ProfilePoint[] = simplified.map((point) => ({
      x: ((point.distance as number) / maxDist) * PROFILE_WIDTH,
      y: PROFILE_HEIGHT - (((point.altitude as number) - minAlt) / altSpan) * PROFILE_HEIGHT,
      distance: point.distance as number,
      altitude: point.altitude as number,
      timestamp: point.timestamp,
    }))

    // 相邻点坡度（按距离窗口平滑，压掉海拔量化噪声）；窗口无样本时退化为直接坡度
    const grades: number[] = []
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]
      const b = points[i + 1]
      const mid = (a.distance + b.distance) / 2
      const half = GRADE_WINDOW_METERS / 2
      let firstAlt: number | undefined
      let lastAlt = 0
      let lastDist = 0
      for (const point of points) {
        if (point.distance < mid - half) {
          continue
        }
        if (point.distance > mid + half) {
          break
        }
        if (firstAlt === undefined) {
          firstAlt = point.altitude
        }
        lastAlt = point.altitude
        lastDist = point.distance
      }
      if (firstAlt !== undefined && lastDist - a.distance > 0) {
        grades.push(((lastAlt - firstAlt) / (lastDist - a.distance)) * 100)
      } else {
        const dDist = b.distance - a.distance
        grades.push(dDist > 0 ? ((b.altitude - a.altitude) / dDist) * 100 : 0)
      }
    }

    // 同色相邻段合并为一条折线，减少 SVG 节点
    const coloredSegments: ColoredSegment[] = []
    for (let i = 0; i + 1 < points.length; i++) {
      const color = gradeColor(grades[i])
      const pointStr = `${points[i].x.toFixed(1)},${points[i].y.toFixed(1)} ${points[i + 1].x.toFixed(1)},${points[i + 1].y.toFixed(1)}`
      const last = coloredSegments[coloredSegments.length - 1]
      if (last !== undefined && last.color === color) {
        const trimmed = last.points.slice(0, last.points.lastIndexOf(' '))
        last.points = `${trimmed} ${pointStr}`
      } else {
        coloredSegments.push({ color, points: pointStr })
      }
    }

    // 分段色带：每段一个半透明矩形（下界 0.5 视口宽保证可见）
    const bands: ProfileBand[] = built.map((segment, index) => {
      const x1 = (segment.startDistanceMeters / maxDist) * PROFILE_WIDTH
      const x2 = (segment.endDistanceMeters / maxDist) * PROFILE_WIDTH
      return {
        x: x1,
        width: Math.max(x2 - x1, 0.5),
        type: segment.type,
        index,
      }
    })

    // UCI 级别徽章：爬坡段缺失级别不渲染；锚点为段内最高海拔点
    const badges: ClimbBadge[] = []
    for (let index = 0; index < built.length; index++) {
      const segment = built[index]
      if (segment.type !== 'climb') {
        continue
      }
      const level = uciCategory(segment.distanceMeters, segment.avgGradePercent)
      if (level === null) {
        continue
      }
      let peak: ProfilePoint | null = null
      for (const point of points) {
        if (
          point.distance < segment.startDistanceMeters - 1 ||
          point.distance > segment.endDistanceMeters + 1
        ) {
          continue
        }
        if (peak === null || point.altitude > peak.altitude) {
          peak = point
        }
      }
      const midX = ((segment.startDistanceMeters + segment.endDistanceMeters) / 2 / maxDist) * PROFILE_WIDTH
      badges.push({
        index,
        level,
        x: midX,
        y: peak !== null ? peak.y : 0,
      })
    }

    return {
      climbs,
      segments: built,
      insights,
      profile: { points, grades: coloredSegments, bands, badges, maxDist, minAlt, maxAlt },
      climbCount,
      flatCount,
    }
  }, [records])

  // 悬停距离换算 + 上报：鼠标 x → 视口 x → 距离 → 分段下标/最近剖面点时间戳
  function handleProfileMove(event: React.MouseEvent<SVGSVGElement>) {
    if (profile === null) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) {
      return
    }
    const x = ((event.clientX - rect.left) / rect.width) * PROFILE_WIDTH
    setHoverX(x)
    const distanceMeters = (x / PROFILE_WIDTH) * profile.maxDist
    setHoverIndex(segmentIndexAtDistance(segments, distanceMeters))
    // 按距离最近取剖面点，再取时间戳（剖面 x 轴即距离轴）
    let nearest: ProfilePoint | undefined
    let bestDiff = Infinity
    for (const candidate of profile.points) {
      const diff = Math.abs(candidate.distance - distanceMeters)
      if (diff < bestDiff) {
        bestDiff = diff
        nearest = candidate
      }
    }
    onHover?.(nearest?.timestamp)
  }

  // 移出剖面：清除悬停与分段高亮并通知上层
  function handleProfileLeave() {
    setHoverX(undefined)
    setHoverIndex(undefined)
    onHover?.(undefined)
  }

  // 外部悬停时间戳 → 剖面点（参考线定位 x；未命中返回 undefined）
  const externalPoint = useMemo(() => {
    if (profile === null || hoverTimestamp === undefined) {
      return undefined
    }
    return findNearestByTimestamp(profile.points, hoverTimestamp)
  }, [profile, hoverTimestamp])

  // 参考线位置：优先本图悬停（鼠标所在），否则外部悬停
  const cursorX = hoverX ?? externalPoint?.x

  // 无爬坡时区块不渲染（纯平路骑行无爬坡/分段分析）
  if (climbs.length === 0 || segments.length === 0) {
    return null
  }

  return (
    <section className="segments-section" aria-label="爬坡与分段分析">
      <h2 className="segments-section__title">爬坡与分段分析</h2>
      <p className="segments-section__summary">
        共 {climbCount} 段爬坡、{flatCount} 段平路（连续爬升 ≥ 30 米且平均坡度 ≥ 1.5% 记为爬坡；悬停剖面或卡片联动定位）
      </p>

      {profile !== null && (
        <div className="segments-section__profile-wrap">
          <svg
            className="segments-section__profile"
            viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`}
            preserveAspectRatio="none"
            onMouseMove={handleProfileMove}
            onMouseLeave={handleProfileLeave}
            role="img"
            aria-label="海拔剖面图，按坡度着色标注平路与爬坡分段，鼠标悬停可联动地图定位"
          >
            {/* 平路/爬坡色带 */}
            {profile.bands.map((band) => (
              <rect
                key={band.index}
                x={band.x.toFixed(1)}
                y={0}
                width={band.width.toFixed(1)}
                height={PROFILE_HEIGHT}
                className={
                  hoverIndex === band.index
                    ? `segments-section__band segments-section__band--${band.type} segments-section__band--active`
                    : `segments-section__band segments-section__band--${band.type}`
                }
                data-testid="segment-band"
              />
            ))}
            {/* 坡度着色海拔折线 */}
            {profile.grades.map((segment, index) => (
              <polyline
                key={index}
                points={segment.points}
                fill="none"
                stroke={segment.color}
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
            ))}
            {/* 悬停参考线 + 圆点 */}
            {cursorX !== undefined && (
              <g>
                <line
                  x1={cursorX}
                  y1={0}
                  x2={cursorX}
                  y2={PROFILE_HEIGHT}
                  stroke={HOVER_LINE_COLOR}
                  strokeWidth="0.8"
                  strokeDasharray="2 1.5"
                  data-testid="hover-line"
                />
                <circle
                  cx={cursorX}
                  cy={Math.min(4, PROFILE_HEIGHT - 4)}
                  r={2.2}
                  fill={HOVER_DOT_COLOR}
                  stroke={HOVER_LINE_COLOR}
                  strokeWidth="1"
                />
              </g>
            )}
          </svg>

          {/* 海拔轴标注 */}
          <div className="segments-section__profile-labels" aria-hidden="true">
            <span className="segments-section__profile-label">{Math.round(profile.maxAlt)} m</span>
            <span className="segments-section__profile-label">{Math.round(profile.minAlt)} m</span>
          </div>

          {/* UCI 级别徽章（HTML 覆盖，坐标与视口 0-100 对齐） */}
          {profile.badges.map((badge) => (
            <span
              key={badge.index}
              className="segments-section__badge"
              style={{
                left: `${badge.x.toFixed(1)}%`,
                top: `calc(${badge.y.toFixed(1)}% - 14px)`,
                backgroundColor: LEVEL_COLORS[badge.level],
              }}
            >
              {levelLabel(badge.level)}
            </span>
          ))}
        </div>
      )}

      {/* 坡度色阶图例 */}
      <div className="segments-section__legend" role="img" aria-label="坡度色阶图例">
        {GRADE_COLORS.map((entry) => (
          <span key={entry.label} className="segments-section__legend-item">
            <i className="segments-section__legend-swatch" style={{ backgroundColor: entry.color }} />
            {entry.label}
          </span>
        ))}
        <span className="segments-section__legend-item">
          <i className="segments-section__legend-swatch segments-section__legend-swatch--band" style={{ backgroundColor: BAND_COLORS.flat }} />
          平路段
        </span>
        <span className="segments-section__legend-item">
          <i className="segments-section__legend-swatch segments-section__legend-swatch--band" style={{ backgroundColor: BAND_COLORS.climb }} />
          爬坡段
        </span>
      </div>

      {/* 全量分段卡片（平路 + 爬坡，悬停联动色带） */}
      <ul className="segment-list">
        {segments.map((segment, index) => (
          <li
            key={index}
            className={`segment-card segment-card--${segment.type}${
              hoverIndex === index ? ' segment-card--active' : ''
            }`}
            data-testid={`segment-card-${index}`}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex(undefined)}
          >
            <span className="segment-card__label">{segment.label}</span>
            <span className="segment-card__range">
              {formatDistanceByUnit(segment.startDistanceMeters, distanceUnit)} –{' '}
              {formatDistanceByUnit(segment.endDistanceMeters, distanceUnit)}
              {' · '}
              {formatDistanceByUnit(segment.distanceMeters, distanceUnit)}
            </span>
            <span className="segment-card__stats">
              {segment.elevationGain > 0 && `爬升 ${Math.round(segment.elevationGain)} m`}
              {segment.avgGradePercent > 0.5 && ` · 均 ${segment.avgGradePercent.toFixed(1)}%`}
              {' · '}
              {segment.avgSpeedMps === undefined
                ? '速度 —'
                : `速度 ${formatSpeedByUnit(segment.avgSpeedMps, distanceUnit)}`}
              {segment.avgPowerW !== undefined && ` · 功率 ${Math.round(segment.avgPowerW)} W`}
              {segment.avgHeartRateBpm !== undefined &&
                ` · 心率 ${Math.round(segment.avgHeartRateBpm)} bpm`}
            </span>
          </li>
        ))}
      </ul>

      {insights.length > 0 && (
        <ul className="segment-insights" aria-label="相邻爬坡对比洞察">
          {insights.map((insight, index) => (
            <li key={index} className="segment-insights__item">
              {insight.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default SegmentsSection