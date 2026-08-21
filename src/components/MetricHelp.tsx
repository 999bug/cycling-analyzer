/**
 * 指标说明折叠块（UI-7）：高级训练指标（NP/IF/TSS/CTL/ATL/TSB/EF 等）
 * 的「怎么算 / 怎么理解」说明，原生 details 折叠免状态。
 *
 * 与详情页区间 `zones-help` 同视觉规格；仪表盘训练状态、表现趋势页共用。
 */
import '@/components/MetricHelp.css'

/** 说明条目：名称 + 算法 + 解读 */
export interface MetricHelpItem {
  /** 指标名称（如「体能（CTL）」） */
  name: string
  /** 怎么算 / 怎么理解 */
  description: string
}

/**
 * 指标说明折叠块。
 *
 * @param items 说明条目列表
 * @param title 折叠标题（默认「指标说明」）
 */
function MetricHelp({ items, title = '指标说明' }: { items: readonly MetricHelpItem[]; title?: string }) {
  return (
    <details className="metric-help">
      <summary className="metric-help__summary">{title}</summary>
      <ul className="metric-help__list">
        {items.map((item) => (
          <li key={item.name}>
            <strong className="metric-help__name">{item.name}</strong>
            <span className="metric-help__desc">{item.description}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default MetricHelp
