/**
 * 爬坡分析区块：整条路线海拔剖面图（SVG），剖面线按坡度连续着色
 * （绿=平路、黄/橙=缓-中坡、红=陡坡、蓝=下坡，Strava 坡度洞察风格），
 * 爬坡段在峰值处打 UCI 级别徽章（4 级 → HC），下方级别卡片列表。
 * 鼠标悬停剖面可联动地图定位（onHover 上报距离）。无爬坡时区块不渲染。
 */
import { useMemo, useState } from 'react'
import { buildClimbs, uciCategory, type UciCategory } from '@/features/activity/climbs'
import { simplifyRoute } from '@/map/simplify'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { ActivityRecord } from '@/types/activity'
import { findNearestByTimestamp } from '@/charts/timeline'
import '@/features/activity/ClimbSection.css'

/** 剖面抽稀阈值（米）——SVG 小图展示，粗抽稀即可 */
const PROFILE_SIMPLIFY_METERS = 5

/** 剖面视口 */
const PROFILE_WIDTH = 100
const PROFILE_HEIGHT = 60

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

/** 剖面点（归一化到视口 + 保留原始距离/海拔/时间戳） */
interface ProfilePoint {
  /** 视口 x（0-100） */
  x: number

  /** 视口 y（0-60，越大越低） */
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

/**
 * 爬坡分析区块 props。
 */
export interface ClimbSectionProps {
  /** 逐点记录（含海拔/距离） */
  records: ActivityRecord[]

  /** 距离显示单位（规格 §27） */
  distanceUnit: DistanceUnit

  /** 共享时间轴：外部悬停时间戳（Unix 秒）；命中时渲染参考线 */
  hoverTimestamp?: number

  /** 悬停回调：鼠标滑过剖面时上报所在点时间戳（Unix 秒）；移出时传 undefined */
  onHover?: (timestamp: number | undefined) => void
}

/**
 * 爬坡分析区块组件。
 *
 * @param props 组件参数
 */
function ClimbSection({ records, distanceUnit, hoverTimestamp, onHover }: ClimbSectionProps) {
  // 悬停位置（视口 x 坐标；undefined = 未悬停）
  const [hoverX, setHoverX] = useState<number>()

  // 爬坡段计算：records 变化时重算（纯函数，O(n)）
  const climbs = useMemo(() => buildClimbs(records), [records])

  // 剖面点（抽稀 + 海拔/距离归一化到视口；保留 timestamp 供共享时间轴匹配）
  const profile = useMemo(() => {
    const points = simplifyRoute(records, PROFILE_SIMPLIFY_METERS).filter(
      (point) => point.altitude !== undefined && point.distance !== undefined,
    )
    if (points.length < 2) {
      return null
    }
    let minAlt = Infinity
    let maxAlt = -Infinity
    let maxDist = 0
    for (const point of points) {
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
    const normalized: ProfilePoint[] = points.map((point) => ({
      x: ((point.distance as number) / maxDist) * PROFILE_WIDTH,
      y: PROFILE_HEIGHT - (((point.altitude as number) - minAlt) / altSpan) * PROFILE_HEIGHT,
      distance: point.distance as number,
      altitude: point.altitude as number,
      timestamp: point.timestamp,
    }))

    // 相邻点坡度（按距离窗口平滑，压掉海拔量化噪声）；窗口无样本时退化为直接坡度
    const grades: number[] = []
    for (let i = 0; i + 1 < normalized.length; i++) {
      const a = normalized[i]
      const b = normalized[i + 1]
      const mid = (a.distance + b.distance) / 2
      const half = GRADE_WINDOW_METERS / 2
      let firstAlt: number | undefined
      let lastAlt = 0
      let lastDist = 0
      for (const point of normalized) {
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
    const segments: ColoredSegment[] = []
    for (let i = 0; i + 1 < normalized.length; i++) {
      const color = gradeColor(grades[i])
      const pointStr = `${normalized[i].x.toFixed(1)},${normalized[i].y.toFixed(1)} ${normalized[i + 1].x.toFixed(1)},${normalized[i + 1].y.toFixed(1)}`
      const last = segments[segments.length - 1]
      if (last !== undefined && last.color === color) {
        // 合并：去掉上一段的终点，接上当前段
        const trimmed = last.points.slice(0, last.points.lastIndexOf(' '))
        last.points = `${trimmed} ${pointStr}`
      } else {
        segments.push({ color, points: pointStr })
      }
    }

    return { maxDist, points: normalized, segments }
  }, [records])

  // 悬停距离（米）换算 + 上报：鼠标 x → 视口 x → 距离 → 最近剖面点时间戳
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

  // 移出剖面：清除悬停并通知上层
  function handleProfileLeave() {
    setHoverX(undefined)
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

  if (climbs.length === 0) {
    return null
  }

  // 爬坡峰值点（段内最高海拔），用于徽章定位
  function climbPeak(climb: { startDistanceMeters: number; endDistanceMeters: number }) {
    if (profile === null) {
      return null
    }
    let peak: ProfilePoint | null = null
    for (const point of profile.points) {
      if (point.distance < climb.startDistanceMeters || point.distance > climb.endDistanceMeters) {
        continue
      }
      if (peak === null || point.altitude > peak.altitude) {
        peak = point
      }
    }
    return peak
  }

  return (
    <section className="climb-section" aria-label="爬坡分析">
      <h2 className="climb-section__title">爬坡分析</h2>
      <p className="climb-section__summary">
        共 {climbs.length} 段爬坡（连续爬升 ≥ 30 米且平均坡度 ≥ 1.5%，UCI 近似分级）
      </p>

      {profile !== null && (
        <div className="climb-section__profile-wrap">
          <svg
            className="climb-section__profile"
            viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`}
            preserveAspectRatio="none"
            onMouseMove={handleProfileMove}
            onMouseLeave={handleProfileLeave}
            role="img"
            aria-label="海拔剖面图，按坡度着色，鼠标悬停可联动地图定位"
          >
            {/* 坡度着色折线（Strava 坡度洞察风格） */}
            {profile.segments.map((segment, index) => (
              <polyline
                key={index}
                points={segment.points}
                fill="none"
                stroke={segment.color}
                strokeWidth="2.4"
                strokeLinejoin="round"
              />
            ))}
            {/* 悬停参考线 + 圆点（共享时间轴联动地图/图表） */}
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
                />
                <circle
                  cx={cursorX}
                  cy={2}
                  r={2.2}
                  fill={HOVER_DOT_COLOR}
                  stroke={HOVER_LINE_COLOR}
                  strokeWidth="1"
                />
              </g>
            )}
          </svg>

          {/* 爬坡级别徽章（HTML 覆盖，避免 SVG 文字拉伸变形） */}
          {climbs.map((climb, index) => {
            const level = uciCategory(climb.distanceMeters, climb.avgGradePercent)
            if (level === null) {
              return null
            }
            const peak = climbPeak(climb)
            const leftPercent = (climb.startDistanceMeters + climb.endDistanceMeters) / 2 / profile.maxDist * 100
            const topPercent = peak === null ? 0 : (peak.y / PROFILE_HEIGHT) * 100
            return (
              <span
                key={index}
                className="climb-section__badge"
                style={{
                  left: `${leftPercent.toFixed(1)}%`,
                  top: `calc(${topPercent.toFixed(1)}% - 12px)`,
                  backgroundColor: LEVEL_COLORS[level],
                }}
              >
                {levelLabel(level)}
              </span>
            )
          })}
        </div>
      )}

      {/* 坡度色阶图例 */}
      <div className="climb-section__legend" role="img" aria-label="坡度色阶图例">
        {GRADE_COLORS.map((entry) => (
          <span key={entry.label} className="climb-section__legend-item">
            <i className="climb-section__legend-swatch" style={{ backgroundColor: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>

      <ul className="climb-list">
        {climbs.map((climb, index) => {
          const level = uciCategory(climb.distanceMeters, climb.avgGradePercent)
          return (
            <li key={index} className="climb-card">
              <span
                className="climb-card__badge"
                style={{ backgroundColor: level !== null ? LEVEL_COLORS[level] : 'var(--border)' }}
              >
                {level !== null ? levelLabel(level) : '坡'}
              </span>
              <span className="climb-card__name">爬坡 {index + 1}</span>
              <span className="climb-card__stats">
                {formatDistanceByUnit(climb.distanceMeters, distanceUnit)} ·{' '}
                {Math.round(climb.elevationGain)} m · 均 {climb.avgGradePercent.toFixed(1)}% · 最陡{' '}
                {climb.maxGradePercent.toFixed(1)}%
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default ClimbSection