/**
 * 赛段 AI 点评（AI 接入 v4）：在「本次赛段」区块尾部追加一段 AI 点评——
 * 一段综述 + 每条赛段一句点评。交互与 v3 agent 式一致（思考卡 + 流式 +
 * 可终止），结果按活动缓存，未配置 AI 服务时不渲染。
 *
 * 与洞察/评分的 AiEnhanceBlock 分开实现的原因：赛段区块在无赛段时整体
 * 不渲染，点评入口必须挂在有数据的位置（赛段列表尾部）而不是包一层。
 */
import { useEffect, useState } from 'react'
import { selectAiReady, useAiConfigStore } from '@/features/ai/aiConfigStore'
import { segmentsCommentStreamParams } from '@/features/ai/aiService'
import { useAgentStream } from '@/features/ai/useAgentStream'
import AgentThinking from '@/features/ai/AgentThinking'
import { getCachedText, setCachedText } from '@/features/ai/insightCache'
import type { AiSegmentView } from '@/features/ai/aiPrompts'
import '@/features/ai/ai.css'

/** 赛段 AI 点评 props */
export interface SegmentAiCommentProps {
  /** 活动 ID（缓存键用） */
  activityId: string

  /** 活动名（prompt 引用；可选） */
  activityName?: string

  /** 本次经过的赛段行（本地计时结果） */
  views: readonly AiSegmentView[]
}

/** 赛段点评缓存键前缀（key = `${PREFIX}:${activityId}`） */
const CACHE_PREFIX = 'segments'

/**
 * 赛段 AI 点评组件（未配置 AI 服务或无赛段时不渲染）。
 *
 * @param props 组件参数
 */
function SegmentAiComment({ activityId, activityName, views }: SegmentAiCommentProps) {
  const aiReady = useAiConfigStore(selectAiReady)
  const cacheKey = `${CACHE_PREFIX}:${activityId}`
  const [show, setShow] = useState(false)
  const [notice, setNotice] = useState('')
  const agent = useAgentStream()

  const running = agent.phase === 'thinking' || agent.phase === 'content'
  const hasAi = getCachedText(cacheKey) !== undefined || agent.phase === 'done'

  // 完成时写入活动缓存（外部系统副作用，无 setState；终止的部分结果不缓存）
  useEffect(() => {
    if (agent.phase === 'done' && agent.content.trim().length > 0) {
      setCachedText(cacheKey, agent.content.trim())
    }
  }, [agent.phase, agent.content, cacheKey])

  if (!aiReady || views.length === 0) {
    return null
  }

  const cachedText = getCachedText(cacheKey)
  const display =
    agent.phase === 'idle' || (agent.phase === 'stopped' && agent.content.trim().length === 0)
      ? cachedText
      : agent.content.trim().length > 0
        ? agent.content
        : cachedText

  /** 生成 / 重新生成点评 */
  function handleGenerate() {
    if (running) {
      return
    }
    setNotice('')
    setShow(true)
    try {
      agent.start(segmentsCommentStreamParams(views, activityName), (outcome) => {
        if (outcome.phase === 'error') {
          setNotice(outcome.error)
        }
      })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 点评失败，请重试')
    }
  }

  return (
    <div className="segment-ai" aria-label="赛段 AI 点评">
      <div className="ai-enhance__bar">
        <button type="button" className="ai-enhance__btn ai-enhance__btn--ai" onClick={handleGenerate} disabled={running}>
          {running ? 'AI 点评中…' : hasAi ? '重新生成点评' : 'AI 点评赛段'}
        </button>
        {hasAi && !running && (
          <button type="button" className="ai-enhance__btn" onClick={() => setShow((current) => !current)}>
            {show ? '收起点评' : '查看点评'}
          </button>
        )}
      </div>
      {(show || running) && (
        <div className="ai-enhance__pane">
          <div className="ai-badge">AI 版 · 基于本地计时结果，可重新生成</div>
          <AgentThinking phase={agent.phase} reasoning={agent.reasoning} elapsedSec={agent.elapsedSec} />
          {display !== undefined && display.length > 0 && <div className="ai-prose">{display}</div>}
          {agent.phase === 'error' && <p className="ai-insight__error">{agent.error}</p>}
          {notice.length > 0 && <p className="ai-insight__error">{notice}</p>}
        </div>
      )}
    </div>
  )
}

export default SegmentAiComment
