/**
 * 海拔图表（规格 §17）：X 轴固定距离，面积渐变渲染。
 */
import type { ActivityRecord } from '@/types/activity'
import MetricChart from '@/charts/MetricChart'

/**
 * 海拔图表 props。
 */
export interface ElevationChartProps {
  /** 逐点记录 */
  records: readonly ActivityRecord[]

  /** 共享时间轴：外部悬停时间戳 */
  hoverTimestamp?: number

  /** 共享时间轴：上报本图悬停时间戳 */
  onHover?: (timestamp: number | undefined) => void
}

/**
 * 海拔图表（米，X 轴固定距离）。
 *
 * @param props 组件参数
 */
function ElevationChart({ records, hoverTimestamp, onHover }: ElevationChartProps) {
  return (
    <MetricChart
      title="海拔"
      metric="altitude"
      records={records}
      meta={{ color: '#34c759', unit: 'm' }}
      switchable={false}
      area
      emptyText="该活动没有海拔数据"
      hoverTimestamp={hoverTimestamp}
      onHover={onHover}
    />
  )
}

export default ElevationChart
