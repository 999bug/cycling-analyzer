/**
 * 温度图表（°C）。
 *
 * FIT 逐点 temperature 字段（设备温度传感器），缺失数据的活动不渲染。
 */
import MetricChart from '@/charts/MetricChart'
import type { ActivityRecord } from '@/types/activity'

/**
 * 温度图表 props。
 */
export interface TemperatureChartProps {
  /** 逐点记录（图表区已抽稀） */
  records: ActivityRecord[]

  /** 共享时间轴：外部悬停时间戳 */
  hoverTimestamp?: number

  /** 共享时间轴：上报本图悬停时间戳 */
  onHover?: (timestamp: number | undefined) => void
}

/**
 * 温度图表组件。
 *
 * @param props 组件参数
 */
function TemperatureChart({ records, hoverTimestamp, onHover }: TemperatureChartProps) {
  return (
    <MetricChart
      title="温度"
      metric="temperature"
      records={records}
      meta={{ color: '#fb923c', unit: '°C' }}
      emptyText="该活动没有温度数据"
      hoverTimestamp={hoverTimestamp}
      onHover={onHover}
    />
  )
}

export default TemperatureChart
