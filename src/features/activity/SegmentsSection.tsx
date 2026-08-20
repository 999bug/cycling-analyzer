/**
 * 分段分析区块：海拔剖面分色带状图 + 分段卡片。
 *
 * 顶部展示整条骑行的海拔剖面折线图，平路/爬坡段用不同颜色半透明带状标注；
 * 下方保留原分段卡片（距离/速度/功率/心率）与相邻爬坡对比洞察。
 * 无爬坡时区块不渲染。
 */
import { useMemo } from 'react'
import { buildClimbs } from '@/features/activity/climbs'
import { buildSegments, climbInsights } from '@/features/activity/segments'
import { simplifyRoute } from '@/map/simplify'
import { formatDistanceByUnit, formatSpeedByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { ActivityRecord } from '@/types/activity'
import '@/features/activity/segmentsSection.css'

/** 剖面抽稀阈值（米） */
const PROFILE_SIMPLIFY_METERS = 5

/** 剖面视口尺寸 */
const PROFILE_WIDTH = 100
const PROFILE_HEIGHT = 40

/** 分段色带颜色（半透明） */
const BAND_COLORS = {
  flat: 'rgba(59, 130, 246, 0.15)',
  climb: 'rgba(249, 115, 22, 0.25)',
}

/** 剖面折线色 */
const PROFILE_LINE_COLOR = 'var(--primary)'

/**
 * 分段分析区块 props。
 */
export interface SegmentsSectionProps {
  /** 逐点记录（含距离/海拔/速度/功率/心率） */
  records: ActivityRecord[]

  /** 距离显示单位（距离/速度随偏好换算） */
  distanceUnit: DistanceUnit
}

/**
 * 分段分析区块组件。
 *
 * @param props 组件参数
 */
function SegmentsSection({ records, distanceUnit }: SegmentsSectionProps) {
  // 分段 + 洞察计算
  const { segments, insights, profile } = useMemo(() => {
    const climbs = buildClimbs(records)
    const built = buildSegments(records, climbs)
    const insights = climbInsights(built)

    // 剖面点（抽稀 + 归一化）
    const simplified = simplifyRoute(records, PROFILE_SIMPLIFY_METERS).filter(
      (point) => point.altitude !== undefined && point.distance !== undefined,
    )
    if (simplified.length < 2) {
      return { segments: built, insights, profile: null }
    }
    let minAlt = Infinity
    let maxAlt = -Infinity
    let maxDist = 0
    for (const point of simplified) {
      const alt = point.altitude as number
      if (alt < minAlt) { minAlt = alt }
      if (alt > maxAlt) { maxAlt = alt }
      maxDist = Math.max(maxDist, point.distance as number)
    }
    const altSpan = maxAlt - minAlt || 1
    const points = simplified.map((point) => ({
      x: ((point.distance as number) / maxDist) * PROFILE_WIDTH,
      y: PROFILE_HEIGHT - (((point.altitude as number) - minAlt) / altSpan) * PROFILE_HEIGHT,
      distance: point.distance as number,
    }))
    const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

    // 分段色带：每段一个半透明矩形
    const bands = built.map((segment) => {
      const x1 = (segment.startDistanceMeters / maxDist) * PROFILE_WIDTH
      const x2 = (segment.endDistanceMeters / maxDist) * PROFILE_WIDTH
      return {
        x: x1.toFixed(1),
        width: Math.max(x2 - x1, 0.5).toFixed(1),
        color: segment.type === 'climb' ? BAND_COLORS.climb : BAND_COLORS.flat,
        label: segment.label,
      }
    })

    return { segments: built, insights, profile: { polyline, bands, maxDist, minAlt, maxAlt } }
  }, [records])

  // 无爬坡时区块不渲染
  if (segments.length === 0 || !segments.some((segment) => segment.type === 'climb')) {
    return null
  }

  return (
    <section className="segments-section" aria-label="分段分析">
      <h2 className="segments-section__title">分段分析</h2>
      <p className="segments-section__summary">
        共 {segments.filter((segment) => segment.type === 'climb').length} 段爬坡，
        每段按实际范围统计（平路段含累计爬升，爬坡段止于峰值）
      </p>

      {profile !== null && (
        <div className="segments-section__profile-wrap">
          <svg
            className="segments-section__profile"
            viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="海拔剖面图，分段着色"
          >
            {/* 分段色带 */}
            {profile.bands.map((band, index) => (
              <rect
                key={index}
                x={band.x}
                y={0}
                width={band.width}
                height={PROFILE_HEIGHT}
                fill={band.color}
              />
            ))}
            {/* 海拔折线 */}
            <polyline
              points={profile.polyline}
              fill="none"
              stroke={PROFILE_LINE_COLOR}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          {/* 海拔标注 */}
          <div className="segments-section__profile-labels">
            <span className="segments-section__profile-label">
              {Math.round(profile.minAlt)} m
            </span>
            <span className="segments-section__profile-label">
              {Math.round(profile.maxAlt)} m
            </span>
          </div>
        </div>
      )}

      <ul className="segment-list">
        {segments.map((segment, index) => (
          <li
            key={index}
            className={`segment-card segment-card--${segment.type}`}
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