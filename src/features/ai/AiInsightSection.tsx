/**
 * 详情页 AI 解读行（AI 接入 v1）。
 *
 * 本地已算好的结论由 RideSummaryBanner 展示；本组件只提供 AI 的
 * 口语化解读（1~2 句），数据上行仅限聚合指标（见 aiPrompts）。
 *
 * 行为约束：
 * - 未配置 AI 服务时**整行不渲染**（默认关闭，按需开启）；
 * - 结果按活动缓存（insightCache），已生成过的活动直接展示，不重复计费；
 * - 失败原因就地展示，不打断页面其余功能。
 */
import { useState } from 'react'
import type { Activity } from '@/types/activity'
import type { DistanceUnit } from '@/features/settings/settings'
import { selectAiReady, useAiConfigStore } from '@/features/ai/aiConfigStore'
import { generateAiInsight } from '@/features/ai/aiService'
import { getCachedInsight, setCachedInsight } from '@/features/ai/insightCache'
import '@/features/ai/ai.css'

/** AI 解读行 props */
export interface AiInsightSectionProps {
  /** 活动摘要（上行数据只取聚合指标） */
  activity: Activity

  /** FTP（W）：解读强度结论依据 */
  ftp?: number

  /** 最大心率（bpm）：解读强度结论依据 */
  maxHeartRate?: number

  /** 距离显示单位（规格 §27） */
  distanceUnit: DistanceUnit
}

/**
 * AI 解读行组件（未配置 AI 服务时不渲染）。
 *
 * @param props 组件参数
 */
function AiInsightSection({ activity, ftp, maxHeartRate, distanceUnit }: AiInsightSectionProps) {
  const aiReady = useAiConfigStore(selectAiReady)
  const [text, setText] = useState<string | undefined>(() => getCachedInsight(activity.id))
  const [status, setStatus] = useState<'idle' | 'busy' | 'fail'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  if (!aiReady) {
    return null
  }

  /**
   * 生成解读：成功后写入活动缓存；「重新解读」会用新结果覆盖旧缓存。
   */
  async function handleGenerate() {
    if (status === 'busy') {
      return
    }
    setStatus('busy')
    setErrorMessage('')
    try {
      const insight = await generateAiInsight(activity, { ftp, maxHeartRate, distanceUnit })
      setText(insight)
      setCachedInsight(activity.id, insight)
      setStatus('idle')
    } catch (error) {
      setStatus('fail')
      setErrorMessage(error instanceof Error ? error.message : 'AI 解读失败，请重试')
    }
  }

  return (
    <section className="ai-insight" aria-label="AI 解读">
      <div className="ai-insight__label">AI 解读</div>
      {text !== undefined && <p className="ai-insight__text">{text}</p>}
      <div className="ai-insight__actions">
        <button
          type="button"
          className="ai-insight__btn"
          onClick={() => void handleGenerate()}
          disabled={status === 'busy'}
        >
          {status === 'busy' ? '生成中…' : text !== undefined ? '重新解读' : '生成解读'}
        </button>
        {text === undefined && status === 'idle' && (
          <span className="ai-insight__hint">根据聚合指标写 1~2 句解读；仅上行汇总数字，不含轨迹</span>
        )}
        {status === 'fail' && <span className="ai-insight__error">{errorMessage}</span>}
      </div>
    </section>
  )
}

export default AiInsightSection
