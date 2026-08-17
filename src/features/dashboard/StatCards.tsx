/**
 * 统计卡片区（规格 §13）：展示一个时间段（本周/本月/总计）的
 * 四项指标——骑行次数、骑行距离、骑行时间、累计爬升，大数字卡片风格。
 */
import { formatDuration, formatElevation } from '@/utils/format'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { PeriodSummary } from '@/features/dashboard/statistics'
import '@/features/dashboard/StatCards.css'

interface StatCardsProps {
  /** 时间段标题（本周 / 本月 / 总计） */
  title: string

  /** 时间段聚合结果 */
  summary: PeriodSummary

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/**
 * 渲染一个时间段的四项统计卡片。
 *
 * @param props 时间段标题与聚合数据
 */
function StatCards({ title, summary, distanceUnit = 'km' }: StatCardsProps) {
  const stats = [
    { label: '骑行次数', value: `${summary.count} 次` },
    { label: '骑行距离', value: formatDistanceByUnit(summary.totalDistance, distanceUnit) },
    { label: '骑行时间', value: formatDuration(summary.totalDuration) },
    { label: '累计爬升', value: formatElevation(summary.totalElevationGain) },
  ]

  return (
    <section className="stat-cards" aria-label={title}>
      <h2 className="stat-cards__title">{title}</h2>
      <div className="stat-cards__grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <span className="stat-card__value">{stat.value}</span>
            <span className="stat-card__label">{stat.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default StatCards
