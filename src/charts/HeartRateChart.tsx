/**
 * 心率图表（规格 §17）：X 轴支持 时间/距离 切换。
 */
import type { ActivityRecord } from '@/types/activity'
import MetricChart from '@/charts/MetricChart'

/**
 * 心率图表 props。
 */
export interface HeartRateChartProps {
  /** 逐点记录 */
  records: readonly ActivityRecord[]
}

/**
 * 心率图表（bpm）。
 *
 * @param props 组件参数
 */
function HeartRateChart({ records }: HeartRateChartProps) {
  return (
    <MetricChart
      title="心率"
      metric="heartRate"
      records={records}
      meta={{ color: '#ff6482', unit: 'bpm' }}
      emptyText="该活动没有心率数据"
    />
  )
}

export default HeartRateChart
