/**
 * 通用图表卡片容器：标题 + 标题右侧操作区（X 轴切换等）+ 图表内容。
 * 数据缺失时显示空态提示，不渲染图表（规格 §25 功率图无数据不渲染）。
 */
import type { ReactNode } from 'react'
import '@/charts/charts.css'

/**
 * 图表卡片 props。
 */
export interface ChartCardProps {
  /** 图表标题 */
  title: string

  /** 是否有数据（false 时显示空态提示） */
  hasData: boolean

  /** 无数据时的提示文案（默认「无数据」） */
  emptyText?: string

  /** 标题右侧操作区（如 X 轴模式切换按钮） */
  extra?: ReactNode

  /** 图表内容 */
  children: ReactNode
}

/**
 * 图表卡片容器。
 *
 * @param props 组件参数
 */
function ChartCard({ title, hasData, emptyText = '无数据', extra, children }: ChartCardProps) {
  return (
    <section className="chart-card">
      <header className="chart-card__header">
        <h3 className="chart-card__title">{title}</h3>
        {extra}
      </header>
      {hasData ? (
        <div className="chart-card__body">{children}</div>
      ) : (
        <div className="chart-card__empty">{emptyText}</div>
      )}
    </section>
  )
}

export default ChartCard
