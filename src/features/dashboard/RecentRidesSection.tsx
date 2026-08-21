/**
 * 仪表盘「最近骑行」区块：填充趋势图与训练状态之外的下半屏留白。
 *
 * 每条骑行渲染为可点击卡片（链接到详情页），展示标题、日期、距离与时长；
 * 数据由 buildDashboardData.recentActivities 提供（最多 5 条）。
 */
import { Link } from 'react-router-dom'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { formatDate, formatDuration } from '@/utils/format'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import '@/features/dashboard/RecentRidesSection.css'

interface RecentRidesSectionProps {
  /** 最近骑行摘要（startTime 降序） */
  rides: readonly ActivitySummary[]

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/**
 * 最近骑行区块。
 *
 * @param props 骑行列表与距离单位
 */
function RecentRidesSection({ rides, distanceUnit = 'km' }: RecentRidesSectionProps) {
  return (
    <section className="recent-rides" aria-label="最近骑行">
      <h2 className="recent-rides__title">最近骑行</h2>
      <ul className="recent-rides__list">
        {rides.map((ride) => (
          <li key={ride.id}>
            <Link className="recent-rides__item" to={`/activities/${ride.id}`}>
              <span className="recent-rides__name">
                {ride.name ?? `${formatDate(ride.startTime)} 骑行`}
              </span>
              <span className="recent-rides__meta">
                {formatDate(ride.startTime)} · {formatDistanceByUnit(ride.distance, distanceUnit)} ·{' '}
                {formatDuration(ride.duration)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default RecentRidesSection
