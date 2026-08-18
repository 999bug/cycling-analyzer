/**
 * 成就区块：本次骑行刷新的历史纪录徽章。
 *
 * 仅在存在成就时渲染（无成就返回 null）；每个成就展示
 * 「纪录名 · 本次值（原纪录 X）」，值按维度格式化并随单位偏好换算。
 */
import type { Achievement } from '@/features/activity/achievements'
import { formatDuration, formatElevation } from '@/utils/format'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'
import '@/features/activity/achievementsSection.css'

/** 成就区块 props */
export interface AchievementsSectionProps {
  /** 刷新的纪录列表（空数组时区块不渲染） */
  achievements: readonly Achievement[]
  /** 距离显示单位（km/mi） */
  distanceUnit: DistanceUnit
}

/**
 * 按成就维度格式化数值。
 *
 * @param achievement 成就
 * @param value 待格式化的值（本次值或原纪录）
 * @param distanceUnit 距离显示单位
 * @returns 展示字符串
 */
function formatAchievementValue(
  achievement: Achievement,
  value: number,
  distanceUnit: DistanceUnit,
): string {
  switch (achievement.key) {
    case 'distance':
      return formatDistanceByUnit(value, distanceUnit)
    case 'duration':
      return formatDuration(value)
    case 'avgSpeed':
      return formatSpeedByUnit(value, distanceUnit)
    case 'elevationGain':
      return formatElevation(value)
    default:
      return `${Math.round(value)} W`
  }
}

/**
 * 成就区块。
 *
 * @param props 组件参数
 */
function AchievementsSection({ achievements, distanceUnit }: AchievementsSectionProps) {
  if (achievements.length === 0) {
    return null
  }

  return (
    <section className="achievements" aria-label="本次成就">
      <h2 className="achievements__title">本次成就</h2>
      <ul className="achievements__list">
        {achievements.map((achievement) => (
          <li key={achievement.key} className="achievements__item">
            <span className="achievements__badge" aria-hidden="true">
              🏆
            </span>
            <span className="achievements__label">{achievement.label}</span>
            <span className="achievements__value">
              {formatAchievementValue(achievement, achievement.value, distanceUnit)}
            </span>
            <span className="achievements__previous">
              原纪录 {formatAchievementValue(achievement, achievement.previousBest, distanceUnit)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default AchievementsSection
