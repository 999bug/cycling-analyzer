/**
 * 设备统计区块（规格 §39 P2）：按设备分组的全时段聚合卡片。
 *
 * 每张卡片展示设备显示名、活动次数、总距离/总时长/总爬升与最近骑行日期。
 * 全部活动都无设备信息时显示「暂无设备信息」提示而非空卡片墙（不伪造，规格 §25）；
 * 部分活动有设备信息时，无设备信息的活动归入「未知设备」卡片一并展示。
 */
import { formatDate, formatDuration, formatElevation } from '@/utils/format'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import {
  UNKNOWN_DEVICE_NAME,
  type DeviceStatsEntry,
} from '@/features/statistics/deviceStats'
import '@/features/statistics/DeviceStatsCards.css'

/**
 * 设备统计区块 props。
 */
export interface DeviceStatsCardsProps {
  /** 设备统计条目（buildDeviceStats 输出，已按活动次数降序） */
  entries: readonly DeviceStatsEntry[]

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/**
 * 设备统计区块。
 *
 * @param props 组件参数
 */
function DeviceStatsCards({ entries, distanceUnit = 'km' }: DeviceStatsCardsProps) {
  const hasKnownDevice = entries.some((entry) => entry.deviceName !== UNKNOWN_DEVICE_NAME)

  return (
    <section className="device-stats" aria-label="设备统计">
      <h3 className="device-stats__title">设备统计</h3>
      {hasKnownDevice ? (
        <div className="device-stats__grid">
          {entries.map((entry) => (
            <DeviceCard key={entry.deviceName} entry={entry} distanceUnit={distanceUnit} />
          ))}
        </div>
      ) : (
        <p className="device-stats__hint">暂无设备信息</p>
      )}
    </section>
  )
}

/**
 * 单张设备卡片：显示名 + 次数 + 聚合指标 + 最近骑行日期。
 *
 * @param entry 设备统计条目
 * @param distanceUnit 距离显示单位
 */
function DeviceCard({ entry, distanceUnit }: { entry: DeviceStatsEntry; distanceUnit: DistanceUnit }) {
  const stats = [
    { label: '总距离', value: formatDistanceByUnit(entry.totalDistance, distanceUnit) },
    { label: '总时长', value: formatDuration(entry.totalDuration) },
    { label: '总爬升', value: formatElevation(entry.totalElevationGain) },
    { label: '最近骑行', value: formatDate(entry.lastRideTime) },
  ]

  return (
    <div className="device-card">
      <div className="device-card__header">
        <span className="device-card__name">{entry.deviceName}</span>
        <span className="device-card__count">{entry.count} 次</span>
      </div>
      <div className="device-card__stats">
        {stats.map((stat) => (
          <div className="device-card__stat" key={stat.label}>
            <span className="device-card__stat-label">{stat.label}</span>
            <span className="device-card__stat-value">{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DeviceStatsCards
