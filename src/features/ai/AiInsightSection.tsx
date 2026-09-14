/**
 * 详情页 AI 解读行（AI 接入 v3：agent 式流式生成）。
 *
 * 本地已算好的结论由 RideSummaryBanner 展示；本组件提供 AI 的
 * 口语化解读，交互沿用 v3 定稿：思考过程卡实时展示、正文流式落框、
 * 全程可终止（已收到部分保留，不写入缓存）。
 *
 * 行为约束：
 * - 未配置 AI 服务时**整行不渲染**（默认关闭，按需开启）；
 * - 完成后按活动缓存（insightCache），已生成过的活动直接展示，不重复计费；
 * - 终止/失败不影响页面其余功能。
 */
import { useEffect, useState } from 'react'
import type { Activity } from '@/types/activity'
import type { DistanceUnit } from '@/features/settings/settings'
import { selectAiReady, useAiConfigStore } from '@/features/ai/aiConfigStore'
import { insightStreamParams } from '@/features/ai/aiService'
import { useAgentStream } from '@/features/ai/useAgentStream'
import AgentThinking from '@/features/ai/AgentThinking'
import { getCachedInsight, setCachedInsight } from '@/features/ai/insightCache'
import { renderAiProse } from '@/features/ai/aiProse'
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
  const [notice, setNotice] = useState('')
  const agent = useAgentStream()

  const running = agent.phase === 'thinking' || agent.phase === 'content'

  // 完成时写入活动缓存（外部系统副作用，无 setState；终止的部分结果不缓存）
  useEffect(() => {
    if (agent.phase === 'done' && agent.content.trim().length > 0) {
      setCachedInsight(activity.id, agent.content.trim())
    }
  }, [agent.phase, agent.content, activity.id])

  if (!aiReady) {
    return null
  }

  // 展示优先级：生成中/刚完成 → 实时内容；待机/终止无正文 → 活动缓存
  const cachedText = getCachedInsight(activity.id)
  const display =
    agent.phase === 'idle' || (agent.phase === 'stopped' && agent.content.trim().length === 0)
      ? cachedText
      : agent.content.trim().length > 0
        ? agent.content
        : cachedText

  /** 生成解读（或重新解读覆盖旧结果） */
  function handleGenerate() {
    if (running) {
      return
    }
    setNotice('')
    try {
      agent.start(insightStreamParams(activity, { ftp, maxHeartRate, distanceUnit }), (outcome) => {
        if (outcome.phase === 'error') {
          setNotice(outcome.error)
        }
      })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 解读失败，请重试')
    }
  }

  return (
    <section className="ai-insight" aria-label="AI 解读">
      <div className="ai-insight__label">AI 解读</div>
      <AgentThinking phase={agent.phase} reasoning={agent.reasoning} elapsedSec={agent.elapsedSec} />
      {display !== undefined && display.length > 0 && <p className="ai-insight__text">{renderAiProse(display)}</p>}
      <div className="ai-insight__actions">
        {running ? (
          <button type="button" className="ai-insight__btn ai-insight__btn--stop" onClick={agent.stop}>
            终止
          </button>
        ) : (
          <button type="button" className="ai-insight__btn" onClick={handleGenerate}>
            {cachedText !== undefined || agent.phase === 'done' ? '重新解读' : '生成解读'}
          </button>
        )}
        {cachedText === undefined && !running && agent.phase === 'idle' && (
          <span className="ai-insight__hint">根据聚合指标写 1~2 句解读；仅上行汇总数字，不含轨迹</span>
        )}
        {agent.phase === 'error' && <span className="ai-insight__error">{agent.error}</span>}
        {notice.length > 0 && <span className="ai-insight__error">{notice}</span>}
      </div>
    </section>
  )
}

export default AiInsightSection
