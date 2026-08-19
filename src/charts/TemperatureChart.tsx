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
}

/**
 * 温度图表组件。
 *
 * @param props 组件参数
 */
function TemperatureChart({ records }: TemperatureChartProps) {
  return (
    <MetricChart
      title="温度"
      metric="temperature"
      records={records}
      meta={{ color: '#fb923c', unit: '°C' }}
      emptyText="该活动没有温度数据"
    />
  )
}

export default TemperatureChart
