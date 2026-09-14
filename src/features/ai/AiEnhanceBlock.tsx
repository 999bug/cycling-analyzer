/**
 * AI 增强区块（AI 接入 v4）：给详情页已有的确定性结论区块加一层
 * 「AI 解读」能力——默认展示本地内容，点按钮后流式生成叙事版并替换，
 * 本地 / AI 可来回切换，可反复重新生成（v4 原型定稿交互）。
 *
 * 组合方式：
 * - AiEnhanceBlock：包裹一个本地区块（children），提供按钮行 + 思考卡
 *   + 流式正文；结果按 cacheKey 缓存（insightCache 通用 KV），重进页面
 *   直接可切 AI 版。
 * - AiEnhanceAllButton：「一键解读全部」——按挂载顺序串行补齐所有
 *   未生成的区块（注册表见 enhanceRegistry.ts）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { selectAiReady, useAiConfigStore } from '@/features/ai/aiConfigStore'
import { getCachedText, setCachedText } from '@/features/ai/insightCache'
import {
  hasEnhanceEntries,
  registerEnhance,
  runAllEnhancements,
  subscribeEnhanceRegistry,
  unregisterEnhance,
  getEnhanceRegistryVersion,
} from '@/features/ai/enhanceRegistry'
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
}

/**
 * AI 增强区块组件（未配置 AI 服务时只渲染 children，无任何按钮）。
 *
 * @param props 组件参数
 */
function AiEnhanceBlock({ cacheKey, buildParams, children, aiLabel = 'AI 解读' }: AiEnhanceBlockProps) {
  const aiReady = useAiConfigStore(selectAiReady)
  const agent = useAgentStream()
  const [mode, setMode] = useState<'local' | 'ai'>('local')

  const running = agent.phase === 'thinking' || agent.phase === 'content'
  // 缓存即「已生成过」的单一真源（生成完成时写入，无需额外 state）
  const cachedText = getCachedText(cacheKey)
  const hasAi = cachedText !== undefined || agent.phase === 'done'

  /** 请求参数与缓存键的 ref（注册表回调始终拿到最新值） */
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

  /** 注册到模块级注册表（一键解读按挂载顺序串行调用） */
  useEffect(() => {
    registerEnhance(cacheKey, {
      hasAi: () => getCachedText(cacheKey) !== undefined || agent.phase === 'done',
      run: () => runGeneration(),
    })
    return () => {
      unregisterEnhance(cacheKey)
    }
  }, [cacheKey, runGeneration, agent.phase])

  // AI 模式展示：流式正文 → 断点部分 → 缓存内容
  const display =
    agent.content.trim().length > 0 ? agent.content : agent.phase === 'idle' ? (cachedText ?? '') : ''

  if (!aiReady) {
    return <>{children}</>
  }

  return (
    <div className="ai-enhance">
      <div className="ai-enhance__bar">
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
        )}
      </div>

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

/** 一键解读按钮 props */
export interface AiEnhanceAllButtonProps {
  /** 自定义文案（默认「一键解读全部」） */
  label?: string
}

/**
 * 「一键解读全部」按钮：串行补齐所有已挂载且未生成的增强区块。
 * 未配置 AI 服务或无增强区块时不渲染。
 *
 * @param props 组件参数
 */
export function AiEnhanceAllButton({ label = '一键解读全部' }: AiEnhanceAllButtonProps) {
  const aiReady = useAiConfigStore(selectAiReady)
  useSyncExternalStore(subscribeEnhanceRegistry, getEnhanceRegistryVersion)
  const [busy, setBusy] = useState(false)

  if (!aiReady || !hasEnhanceEntries()) {
    return null
  }

  async function handleAll() {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      await runAllEnhancements()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-enhance-all">
      <button
        type="button"
        className={busy ? 'ai-pill ai-pill--busy' : 'ai-pill'}
        onClick={() => void handleAll()}
        disabled={busy}
      >
        <span aria-hidden="true">✦</span> {busy ? '解读中…' : label}
      </button>
    </div>
  )
}

export default AiEnhanceBlock
