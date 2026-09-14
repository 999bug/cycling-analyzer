/**
 * 详情页 AI 解读行（AI 接入 v3：agent 式流式生成）。
 *
 * 2.88.1 起交互与 `AiEnhanceBlock` 完全对齐：控件行左侧固定标题「骑行解读」，
 * 右侧为 [本地|AI] 迷你分段 + ⟳ 重新生成（生成中额外给 ■ 终止）——本地模式
 * 展示顶部总结条（RideSummaryBanner，类型徽章 + 真实数据 + 质量短语），
 * AI 模式展示模型解读。未配置 AI 时只渲染总结条本身。
 *
 * 行为约束：
 * - 未配置 AI 服务时**整行不渲染**（默认关闭，按需开启）；
 * - 完成后按活动缓存（insightCache），已生成过的活动直接展示，不重复计费；
 * - 终止/失败不影响页面其余功能。
 */
import { useEffect, useState, type ReactNode } from 'react'
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

  /** 本地态内容（顶部总结条等确定性展示；缺失时本地态为空） */
  localNode?: ReactNode
}

/**
 * 骑行解读行组件（未配置 AI 服务时只渲染本地内容，无任何控件）。
 *
 * @param props 组件参数
 */
function AiInsightSection({
  activity,
  ftp,
  maxHeartRate,
  distanceUnit,
  localNode,
}: AiInsightSectionProps) {
  const aiReady = useAiConfigStore(selectAiReady)
  // 已有缓存 = 用户要的就是 AI 版，直接进 AI 态；否则先看本地总结
  const [mode, setMode] = useState<'local' | 'ai'>(() =>
    getCachedInsight(activity.id) === undefined ? 'local' : 'ai',
  )
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
    // 未配置 AI：只显示本地内容（总结条），不渲染任何 AI 控件
    return <>{localNode}</>
  }

  const cachedText = getCachedInsight(activity.id)
  const hasAi = cachedText !== undefined || agent.phase === 'done'
  // AI 态展示优先级：流式正文 → 终止后的部分结果 → 缓存
  const aiText = agent.content.trim().length > 0 ? agent.content : (cachedText ?? '')

  /** 生成解读（或重新解读覆盖旧结果） */
  function handleGenerate() {
    if (running) {
      return
    }
    setNotice('')
    setMode('ai')
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
    <section className="ai-enhance" aria-label="骑行解读">
      <div className="ai-enhance__bar ai-enhance__bar--titled">
        <h2 className="ai-enhance__title">骑行解读</h2>
        {hasAi ? (
          <>
            <div className="ai-miniseg" role="group" aria-label="结论来源切换">
              <button
                type="button"
                className={mode === 'local' ? 'on' : ''}
                aria-pressed={mode === 'local'}
                onClick={() => setMode('local')}
              >
                本地
              </button>
              <button
                type="button"
                className={mode === 'ai' ? 'on' : ''}
                aria-pressed={mode === 'ai'}
                onClick={() => setMode('ai')}
              >
                AI
              </button>
            </div>
            <button
              type="button"
              className="ai-iconbtn"
              title="重新生成 AI 解读"
              aria-label="重新生成 AI 解读"
              onClick={handleGenerate}
              disabled={running}
            >
              ⟳
            </button>
          </>
        ) : (
          <button
            type="button"
            className={running ? 'ai-pill ai-pill--busy' : 'ai-pill'}
            onClick={handleGenerate}
            disabled={running}
          >
            <span aria-hidden="true">✦</span> {running ? 'AI 解读中…' : 'AI 解读'}
          </button>
        )}
        {running && (
          <button
            type="button"
            className="ai-iconbtn"
            title="终止生成"
            aria-label="终止生成"
            onClick={agent.stop}
          >
            ■
          </button>
        )}
      </div>

      {mode === 'ai' ? (
        <div className="ai-enhance__pane">
          <div className="ai-block">
            <div className="ai-block__meta">
              <span className="dot" />
              <span>AI 生成</span>
              <span className="token">
                {agent.reasoning.length > 0 && `· 思考 ~${Math.round(agent.reasoning.length * 0.6)} token `}
                {agent.elapsedSec > 0 && `· ${agent.elapsedSec.toFixed(1)}s`}
              </span>
            </div>
            {aiText.length > 0 ? (
              <div className="ai-prose">{renderAiProse(aiText)}</div>
            ) : running ? (
              <>
                <div className="ai-shimmer" />
                <div className="ai-shimmer" />
                <div className="ai-shimmer" />
              </>
            ) : (
              <div className="ai-enhance__placeholder">正在生成…</div>
            )}
          </div>
          <AgentThinking phase={agent.phase} reasoning={agent.reasoning} elapsedSec={agent.elapsedSec} />
          {agent.phase === 'error' && <p className="ai-insight__error">{agent.error}</p>}
          {agent.phase === 'stopped' && (
            <p className="ai-insight__error">已终止（已发生的用量照常计费）</p>
          )}
          {notice.length > 0 && <p className="ai-insight__error">{notice}</p>}
        </div>
      ) : (
        <>
          {localNode}
          {!hasAi && (
            <p className="ai-insight__hint">根据聚合指标写 1~2 句解读；仅上行汇总数字，不含轨迹</p>
          )}
          {notice.length > 0 && <p className="ai-insight__error">{notice}</p>}
        </>
      )}
    </section>
  )
}

export default AiInsightSection
