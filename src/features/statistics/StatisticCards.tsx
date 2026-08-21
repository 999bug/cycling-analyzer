/**
 * 统计指标卡片网格（规格 §28）。
 *
 * 展示十个指标——骑行次数、总距离、总时间、总爬升、平均单次距离、
 * 平均速度、最长骑行、单次最大爬升、最快速度、最高功率，
 * 大数字卡片风格，颜色复用全局 CSS 变量。
 */
import { formatDuration, formatElevation } from '@/utils/format'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'
import type { StatisticsMetrics } from '@/features/statistics/statistics'
import '@/features/statistics/StatisticCards.css'

interface StatisticCardsProps {
  /** 当前统计范围标签（如 本周 / 全部） */
  title: string

  /** 统计指标 */
  metrics: StatisticsMetrics

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/**
 * 渲染十个统计指标卡片。
 *
 * @param props 范围标题与聚合指标
 */
function StatisticCards({ title, metrics, distanceUnit = 'km' }: StatisticCardsProps) {
  const stats = [
    { label: '骑行次数', value: `${metrics.count} 次` },
    { label: '总距离', value: formatDistanceByUnit(metrics.totalDistance, distanceUnit) },
    { label: '总时间', value: formatDuration(metrics.totalDuration) },
    { label: '总爬升', value: formatElevation(metrics.totalElevationGain) },
    { label: '平均单次距离', value: formatDistanceByUnit(metrics.avgRideDistance, distanceUnit) },
    { label: '平均速度', value: formatSpeedByUnit(metrics.avgSpeed, distanceUnit) },
    { label: '最长骑行', value: formatDistanceByUnit(metrics.longestRide, distanceUnit) },
    { label: '单次最大爬升', value: formatElevation(metrics.maxElevationGain) },
    { label: '最快速度', value: formatSpeedByUnit(metrics.maxSpeed, distanceUnit) },
    // 功率缺失 = undefined ≠ 0，显示 —（规格 §25）
    { label: '最高功率', value: metrics.maxPower !== undefined ? `${Math.round(metrics.maxPower)} W` : '—' },
  ]

  return (
    <section className="statistic-cards" aria-label="统计指标">
      <h2 className="statistic-cards__title">{title}</h2>
      <div className="statistic-cards__grid">
        {stats.map((stat) => (
          <div className="statistic-card" key={stat.label}>
            <span className="statistic-card__value">{stat.value}</span>
            <span className="statistic-card__label">{stat.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default StatisticCards
