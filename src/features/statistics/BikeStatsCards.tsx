/**
 * 自行车统计区块（规格 §39 自行车统计）：按单车分组的全时段聚合卡片。
 *
 * 每张卡片展示单车名称、活动次数、总距离/总时长/总爬升与最近骑行日期。
 * 全部活动都无单车信息时显示「暂无自行车信息」提示而非空卡片墙（不伪造，规格 §25）；
 * 部分活动有单车信息时，无单车信息的活动归入「未知自行车」卡片一并展示。
 */
import { formatDate, formatDuration, formatElevation } from '@/utils/format'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import { UNKNOWN_BIKE_NAME, type BikeStatsEntry } from '@/features/statistics/bikeStats'
import '@/features/statistics/BikeStatsCards.css'

/**
 * 自行车统计区块 props。
 */
export interface BikeStatsCardsProps {
  /** 自行车统计条目（buildBikeStats 输出，已按活动次数降序） */
  entries: readonly BikeStatsEntry[]

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/**
 * 自行车统计区块。
 *
 * @param props 组件参数
 */
function BikeStatsCards({ entries, distanceUnit = 'km' }: BikeStatsCardsProps) {
  const hasKnownBike = entries.some((entry) => entry.bikeName !== UNKNOWN_BIKE_NAME)

  return (
    <section className="bike-stats" aria-label="自行车统计">
      <h3 className="bike-stats__title">自行车统计</h3>
      {hasKnownBike ? (
        <div className="bike-stats__grid">
          {entries.map((entry) => (
            <BikeCard key={entry.bikeName} entry={entry} distanceUnit={distanceUnit} />
          ))}
        </div>
      ) : (
        <p className="bike-stats__hint">
          暂无自行车信息（设备未写入所选单车，可从 FIT 文件重新导入）
        </p>
      )}
    </section>
  )
}

/**
 * 单张自行车卡片：名称 + 次数 + 聚合指标 + 最近骑行日期。
 *
 * @param entry 自行车统计条目
 * @param distanceUnit 距离显示单位
 */
function BikeCard({ entry, distanceUnit }: { entry: BikeStatsEntry; distanceUnit: DistanceUnit }) {
  const stats = [
    { label: '总距离', value: formatDistanceByUnit(entry.totalDistance, distanceUnit) },
    { label: '总时长', value: formatDuration(entry.totalDuration) },
    { label: '总爬升', value: formatElevation(entry.totalElevationGain) },
    { label: '最近骑行', value: formatDate(entry.lastRideTime) },
  ]

  return (
    <div className="bike-card">
      <div className="bike-card__header">
        <span className="bike-card__name">{entry.bikeName}</span>
        <span className="bike-card__count">{entry.count} 次</span>
      </div>
      <div className="bike-card__stats">
        {stats.map((stat) => (
          <div className="bike-card__stat" key={stat.label}>
            <span className="bike-card__stat-label">{stat.label}</span>
            <span className="bike-card__stat-value">{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default BikeStatsCards