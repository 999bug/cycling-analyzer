/**
 * 骑行洞察区块：把 rideInsights 纯函数输出的自然语言洞察渲染为列表。
 * 语气配色：正面绿 / 负面橙红 / 中性蓝；洞察为空时不渲染（不伪造）。
 */
import { useMemo } from 'react'
import {
  buildRideInsights,
  type RideInsightsOptions,
} from '@/features/insights/rideInsights'
import type { Activity, ActivityRecord } from '@/types/activity'
import '@/features/insights/rideInsightsSection.css'

/** 语气 → 左侧色条与图标颜色 */
const KIND_COLORS: Record<string, string> = {
  positive: '#22c55e',
  negative: '#f97316',
  info: '#4f8cff',
}

/** 语气 → 图标（Unicode 符号，避免引图标库） */
const KIND_ICONS: Record<string, string> = {
  positive: '▲',
  negative: '▼',
  info: '●',
}

/**
 * 骑行洞察区块 props。
 */
export interface RideInsightsSectionProps {
  /** 活动摘要（距离/时长/爬升/功率/心率等） */
  activity: Activity

  /** 逐点记录（含速度/功率/心率/距离） */
  records: ActivityRecord[]

  /** 计算参数（FTP/最大心率/距离单位） */
  options?: RideInsightsOptions
}

/**
 * 骑行洞察区块组件。
 *
 * @param props 组件参数
 */
function RideInsightsSection({ activity, records, options }: RideInsightsSectionProps) {
  const insights = useMemo(() => buildRideInsights(activity, records, options), [activity, records, options])

  if (insights.length === 0) {
    return null
  }

  return (
    <section className="insights-section" aria-label="骑行洞察">
      <h2 className="insights-section__title">骑行洞察</h2>
      <ul className="insights-section__list">
        {insights.map((insight) => (
          <li
            key={insight.key}
            className="insights-item"
            style={{ borderLeftColor: KIND_COLORS[insight.kind] ?? 'var(--border)' }}
          >
            <span
              className="insights-item__icon"
              style={{ color: KIND_COLORS[insight.kind] ?? 'var(--text-secondary)' }}
              aria-hidden="true"
            >
              {KIND_ICONS[insight.kind] ?? '●'}
            </span>
            <div className="insights-item__body">
              <span className="insights-item__title">{insight.title}</span>
              <p className="insights-item__text">{insight.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default RideInsightsSection
