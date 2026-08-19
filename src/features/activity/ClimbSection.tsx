/**
 * 爬坡分析区块：整条路线海拔剖面图（SVG），爬坡段按 UCI 级别着色高亮，
 * 下方级别卡片列表（徽章 + 距离/爬升/坡度）。无爬坡时区块不渲染。
 */
import { useMemo } from 'react'
import { buildClimbs, uciCategory, type UciCategory } from '@/features/activity/climbs'
import { simplifyRoute } from '@/map/simplify'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { ActivityRecord } from '@/types/activity'
import '@/features/activity/ClimbSection.css'

/** 剖面抽稀阈值（米）——SVG 小图展示，粗抽稀即可 */
const PROFILE_SIMPLIFY_METERS = 5

/** 剖面视口 */
const PROFILE_WIDTH = 100
const PROFILE_HEIGHT = 60

/** 剖面折线描边色 */
const PROFILE_LINE_COLOR = 'var(--text-secondary)'

/** UCI 级别色板（Strava 风格：4 级蓝 → HC 紫） */
const LEVEL_COLORS: Record<UciCategory, string> = {
  4: '#3b82f6',
  3: '#22c55e',
  2: '#f59e0b',
  1: '#ef4444',
  HC: '#a855f7',
}

/** 级别显示名 */
function levelLabel(level: UciCategory): string {
  return level === 'HC' ? 'HC' : `${level} 级`
}

/**
 * 爬坡分析区块 props。
 */
export interface ClimbSectionProps {
  /** 逐点记录（含海拔/距离） */
  records: ActivityRecord[]

  /** 距离显示单位（规格 §27） */
  distanceUnit: DistanceUnit
}

/**
 * 爬坡分析区块组件。
 *
 * @param props 组件参数
 */
function ClimbSection({ records, distanceUnit }: ClimbSectionProps) {
  // 爬坡段计算：records 变化时重算（纯函数，O(n)）
  const climbs = useMemo(() => buildClimbs(records), [records])

  // 剖面点（抽稀 + 海拔/距离归一化到视口）
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
    return {
      maxDist,
      points: points
        .map((point) => {
          const x = ((point.distance as number) / maxDist) * PROFILE_WIDTH
          const y = PROFILE_HEIGHT - (((point.altitude as number) - minAlt) / altSpan) * PROFILE_HEIGHT
          return `${x.toFixed(1)},${y.toFixed(1)}`
        })
        .join(' '),
    }
  }, [records])

  if (climbs.length === 0) {
    return null
  }

  return (
    <section className="climb-section" aria-label="爬坡分析">
      <h2 className="climb-section__title">爬坡分析</h2>
      <p className="climb-section__summary">
        共 {climbs.length} 段爬坡（连续爬升 ≥ 30 米且平均坡度 ≥ 1.5%，UCI 近似分级）
      </p>

      {profile !== null && (
        <svg
          className="climb-section__profile"
          viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* 爬坡段区域高亮（按级别色） */}
          {climbs.map((climb, index) => {
            const level = uciCategory(climb.distanceMeters, climb.avgGradePercent)
            if (level === null) {
              return null
            }
            const x1 = (climb.startDistanceMeters / profile.maxDist) * PROFILE_WIDTH
            const x2 = (climb.endDistanceMeters / profile.maxDist) * PROFILE_WIDTH
            const width = Math.max(x2 - x1, 1.5)
            return (
              <rect
                key={index}
                x={x1}
                y={0}
                width={width}
                height={PROFILE_HEIGHT}
                fill={LEVEL_COLORS[level]}
                opacity={0.22}
                rx={1}
              />
            )
          })}
          {/* 海拔折线 */}
          <polyline
            points={profile.points}
            fill="none"
            stroke={PROFILE_LINE_COLOR}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      )}

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
