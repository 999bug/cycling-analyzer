/**
 * 功率图表（规格 §17/§25）：X 轴支持 时间/距离 切换；
 * 无功率数据时整图不渲染（显示空态提示）。
 */
import type { ActivityRecord } from '@/types/activity'
import MetricChart from '@/charts/MetricChart'

/**
 * 功率图表 props。
 */
export interface PowerChartProps {
  /** 逐点记录 */
  records: readonly ActivityRecord[]

  /** 共享时间轴：外部悬停时间戳 */
  hoverTimestamp?: number

  /** 共享时间轴：上报本图悬停时间戳 */
  onHover?: (timestamp: number | undefined) => void
}

/**
 * 功率图表（W）。
 *
 * @param props 组件参数
 */
function PowerChart({ records, hoverTimestamp, onHover }: PowerChartProps) {
  return (
    <MetricChart
      title="功率"
      metric="power"
      records={records}
      meta={{ color: '#ff9f0a', unit: 'W' }}
      emptyText="该活动没有功率数据"
      hoverTimestamp={hoverTimestamp}
      onHover={onHover}
    />
  )
}

export default PowerChart
