/**
 * 速度图表（规格 §17）：X 轴支持 时间/距离 切换。
 */
import type { ActivityRecord } from '@/types/activity'
import MetricChart from '@/charts/MetricChart'

/**
 * 速度图表 props。
 */
export interface SpeedChartProps {
  /** 逐点记录 */
  records: readonly ActivityRecord[]

  /** 共享时间轴：外部悬停时间戳 */
  hoverTimestamp?: number

  /** 共享时间轴：上报本图悬停时间戳 */
  onHover?: (timestamp: number | undefined) => void
}

/**
 * 速度图表（m/s，展示为 km/h）。
 *
 * @param props 组件参数
 */
function SpeedChart({ records, hoverTimestamp, onHover }: SpeedChartProps) {
  return (
    <MetricChart
      title="速度"
      metric="speed"
      records={records}
      meta={{ color: '#4f8cff', unit: 'km/h' }}
      emptyText="该活动没有速度数据"
      hoverTimestamp={hoverTimestamp}
      onHover={onHover}
    />
  )
}

export default SpeedChart
