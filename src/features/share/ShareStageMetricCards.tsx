/**
 * 真实界面分享卡：指标卡行（分享素材 v2）。
 *
 * 站内 stat-card 排版的放大版：值在上、名称在下，缺失值显示 '—' 且不拼单位。
 * 朋友圈 4 列 / 小红书路线 2×2 / 小红书封面 3 列共用本组件。
 */
import type { ShareData } from '@/features/share/shareData'
import { metricUnitSuffix, splitMetricLabel } from '@/features/share/shareStageMetrics'

/** 指标卡行 props */
export interface StageMetricCardsProps {
  /** 指标（分享数据同源） */
  metrics: ShareData['metrics']

  /** 列数（朋友圈 4 / 路线 2×2 = 2 / 封面 3） */
  columns: 2 | 3 | 4
}

/**
 * 指标卡行。
 *
 * @param props 组件参数
 */
export function StageMetricCards({ metrics, columns }: StageMetricCardsProps) {
  return (
    <section className={`share-stage__stats share-stage__stats--${columns}`} aria-label="核心指标">
      {metrics.map((metric) => {
        const { name } = splitMetricLabel(metric.label)
        const unitSuffix = metricUnitSuffix(metric.label, metric.value)
        return (
          <div key={metric.label} className="share-stage__stat">
            <div className="share-stage__stat-value">
              {metric.value}
              {unitSuffix !== undefined && (
                <>
                  {' '}
                  <span className="share-stage__stat-unit">{unitSuffix}</span>
                </>
              )}
            </div>
            <div className="share-stage__stat-label">{name}</div>
          </div>
        )
      })}
    </section>
  )
}
