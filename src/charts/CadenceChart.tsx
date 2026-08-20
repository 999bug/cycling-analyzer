/**
 * 踏频图表（规格 §17 后续增加）：X 轴支持 时间/距离 切换。
 * 缺失踏频的记录由 buildSeries 过滤，不产生 0 值假数据。
 */
import type { ActivityRecord } from '@/types/activity'
import MetricChart from '@/charts/MetricChart'

/**
 * 踏频图表 props。
 */
export interface CadenceChartProps {
  /** 逐点记录 */
  records: readonly ActivityRecord[]

  /** 共享时间轴：外部悬停时间戳 */
  hoverTimestamp?: number

  /** 共享时间轴：上报本图悬停时间戳 */
  onHover?: (timestamp: number | undefined) => void
}

/**
 * 踏频图表（rpm）。
 *
 * @param props 组件参数
 */
function CadenceChart({ records, hoverTimestamp, onHover }: CadenceChartProps) {
  return (
    <MetricChart
      title="踏频"
      metric="cadence"
      records={records}
      meta={{ color: '#a78bfa', unit: 'rpm' }}
      emptyText="该活动没有踏频数据"
      hoverTimestamp={hoverTimestamp}
      onHover={onHover}
    />
  )
}

export default CadenceChart
