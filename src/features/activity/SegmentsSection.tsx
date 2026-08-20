/**
 * 分段分析区块：将整条骑行按「平路 / 爬坡」切成连续分段（segments.ts 纯函数），
 * 每段卡片展示平均速度/平均功率/平均心率/累计爬升/平均坡度，
 * 下方列出相邻爬坡段的对比洞察（如「爬坡 2 比爬坡 1 平均功率高 5.4%，但速度低 21%」）。
 * 无爬坡时区块不渲染。
 */
import { useMemo } from 'react'
import { buildClimbs } from '@/features/activity/climbs'
import { buildSegments, climbInsights } from '@/features/activity/segments'
import { formatDistanceByUnit, formatSpeedByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { ActivityRecord } from '@/types/activity'
import '@/features/activity/segmentsSection.css'

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
  // 分段 + 洞察计算：records 变化时重算（纯函数，O(n)）
  const { segments, insights } = useMemo(() => {
    const climbs = buildClimbs(records)
    const built = buildSegments(records, climbs)
    return { segments: built, insights: climbInsights(built) }
  }, [records])

  // 无爬坡时区块不渲染（与 ClimbSection 一致：纯平路骑行无分段分析意义）
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