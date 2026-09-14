/**
 * AI 增强区块（AI 接入 v4/v6）：给详情页已有的确定性结论区块加一层
 * 「AI 解读」能力——默认展示本地内容，点按钮后流式生成叙事版并替换，
 * 本地 / AI 可来回切换，可反复重新生成（v4 原型定稿交互）。
 *
 * 控件（v5 定稿）：未生成 = 「✦ AI 解读」青色药丸；已生成 = [本地|AI]
 * 迷你分段 + ⟳ 小圆钮。结果按 cacheKey 缓存（insightCache 通用 KV）。
 *
 * 2.86.0：移除「一键解读全部」与其注册表（enhanceRegistry）——所有区块
 * 统一走 AiEnhanceBlock 本身（含赛段区块内部包裹）。
 *
 * 2.88.0：控件行新增左侧标题（title），本地 / AI 两种模式共用——切到 AI
 * 时 children 不渲染，标题若留在 children 里会随内容一起消失。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { selectAiReady, useAiConfigStore } from '@/features/ai/aiConfigStore'
import { getCachedText, setCachedText } from '@/features/ai/insightCache'
import { useAgentStream, type AgentStartParams } from '@/features/ai/useAgentStream'
import { renderAiProse } from '@/features/ai/aiProse'
import AgentThinking from '@/features/ai/AgentThinking'
import '@/features/ai/ai.css'

/** AiEnhanceBlock props */
export interface AiEnhanceBlockProps {
  /** 缓存键（区块:活动 id；同一活动同一区块共享缓存） */
  cacheKey: string

  /** 组装流式请求参数（未配置时同步抛 AiRequestError） */
  buildParams: () => AgentStartParams

  /** 本地确定性结论（默认展示） */
  children: ReactNode

  /** 按钮文案（默认「AI 解读」） */
  aiLabel?: string

  /**
   * 区块标题：渲染在控件行最左侧（本地 / AI 两种模式共用同一份，
   * 切到 AI 时不会消失）。提供了标题时，children 内不应再渲染同
   * 名标题，避免本地态出现两处。
   */
  title?: string
}

/**
 * AI 增强区块组件（未配置 AI 服务时只渲染标题 + children，无任何按钮）。
 *
 * @param props 组件参数
 */
function AiEnhanceBlock({
  cacheKey,
  buildParams,
  children,
  aiLabel = 'AI 解读',
  title,
}: AiEnhanceBlockProps) {
  const aiReady = useAiConfigStore(selectAiReady)
  const agent = useAgentStream()
  const [mode, setMode] = useState<'local' | 'ai'>('local')

  const running = agent.phase === 'thinking' || agent.phase === 'content'
  // 缓存即「已生成过」的单一真源（生成完成时写入，无需额外 state）
  const cachedText = getCachedText(cacheKey)
  const hasAi = cachedText !== undefined || agent.phase === 'done'

  /** 请求参数与缓存键的 ref（buildParams 闭包始终拿到最新值） */
  const buildParamsRef = useRef(buildParams)
  const cacheKeyRef = useRef(cacheKey)
  useEffect(() => {
    buildParamsRef.current = buildParams
    cacheKeyRef.current = cacheKey
  }, [buildParams, cacheKey])

  const runGeneration = useCallback((): Promise<void> => {
    setMode('ai')
    return new Promise((resolve) => {
      try {
        agent.start(buildParamsRef.current(), (outcome) => {
          if (outcome.phase === 'done' && outcome.content.trim().length > 0) {
            setCachedText(cacheKeyRef.current, outcome.content.trim())
          }
          resolve()
        })
      } catch {
        // 未配置等同步异常：结束本次（不打断页面，按钮态保持原样）
        resolve()
      }
    })
    // agent.start / setMode 为稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // AI 模式展示：流式正文 → 断点部分 → 缓存内容
  const display =
    agent.content.trim().length > 0 ? agent.content : agent.phase === 'idle' ? (cachedText ?? '') : ''

  // 标题行：标题固定最左，AI 控件靠右；本地 / AI 两种模式共用这一行
  const head = (
    <div
      className={
        title === undefined ? 'ai-enhance__bar' : 'ai-enhance__bar ai-enhance__bar--titled'
      }
    >
      {title !== undefined && <h2 className="ai-enhance__title">{title}</h2>}
      {aiReady &&
        (hasAi ? (
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
              onClick={() => void runGeneration()}
              disabled={running}
            >
              ⟳
            </button>
          </>
        ) : (
          <button
            type="button"
            className={running ? 'ai-pill ai-pill--busy' : 'ai-pill'}
            onClick={() => void runGeneration()}
            disabled={running}
          >
            <span aria-hidden="true">✦</span> {running ? 'AI 解读中…' : aiLabel}
          </button>
        ))}
    </div>
  )

  if (!aiReady) {
    // 有标题时仍走统一标题行（区块标题不应依赖是否配置 AI），否则原样透传
    if (title === undefined) {
      return <>{children}</>
    }
    return (
      <div className="ai-enhance">
        {head}
        {children}
      </div>
    )
  }
  return (
    <div className="ai-enhance">
      {head}
      {mode === 'ai' && (
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
            {display.length > 0 ? (
              <div className="ai-prose">{renderAiProse(display)}</div>
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
        </div>
      )}

      {mode === 'local' && children}
    </div>
  )
}

export default AiEnhanceBlock
