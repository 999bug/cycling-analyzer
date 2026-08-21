/**
 * 骑行一句话总结条（UI-2 / 评审 P0-01）：类型徽章 + 真实数据总结 +
 * 质量档位短语，让首屏 5 秒回答"骑多久、多少公里、骑得怎么样"。
 * 总结不可得（距离与时长均缺失）时不渲染（不伪造文案）。
 */
import { useMemo } from 'react'
import type { Activity } from '@/types/activity'
import { buildRideSummary, type RideSummaryOptions } from '@/features/insights/rideSummary'
import '@/features/insights/rideSummaryBanner.css'

/**
 * 骑行总结条 props。
 */
export interface RideSummaryBannerProps {
  /** 活动摘要 */
  activity: Activity

  /** 总结计算参数（FTP/最大心率/单位/质量分） */
  options: RideSummaryOptions
}

/**
 * 骑行总结条组件。
 *
 * @param props 组件参数
 */
function RideSummaryBanner({ activity, options }: RideSummaryBannerProps) {
  const summary = useMemo(() => buildRideSummary(activity, options), [activity, options])

  if (summary === undefined) {
    return null
  }

  return (
    <section className="ride-summary" aria-label="骑行总结">
      <span className="ride-summary__type">{summary.rideType}</span>
      <p className="ride-summary__headline">{summary.headline}</p>
      {summary.qualityPhrase !== undefined && (
        <span className="ride-summary__quality">数据质量 {summary.qualityPhrase}</span>
      )}
    </section>
  )
}

export default RideSummaryBanner
