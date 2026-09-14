/**
 * 思考过程行（v5：一行化，替代大思考卡）。
 *
 * 行为（v5 原型定稿）：
 * - 生成中：一行「✦ 思考中 · Ns」，默认收起，点开看流式思考全文；
 * - 完成：一行「✦ 思考 · ~N token」，可展开回看；
 * - 终止：一行「✦ 思考 · 已终止」。
 *
 * token 估算：中文 1 字 ≈ 0.6 token（展示用粗估，不代表计费口径）。
 */
import { useEffect, useRef, useState } from 'react'
import type { AgentPhase } from '@/features/ai/useAgentStream'
import '@/features/ai/ai.css'

/** 思考行 props */
export interface AgentThinkingProps {
  /** agent 当前阶段（idle 时不渲染） */
  phase: AgentPhase

  /** 思考过程累计文本 */
  reasoning: string

  /** 已耗时（秒） */
  elapsedSec: number
}

/** 中文 → token 粗估系数（展示用） */
const ZH_TOKEN_RATIO = 0.6

/**
 * 思考过程行组件（phase = idle 时返回 null）。
 *
 * @param props 组件参数
 */
function AgentThinking({ phase, reasoning, elapsedSec }: AgentThinkingProps) {
  if (phase === 'idle') {
    return null
  }
  return <AgentThinkingLine phase={phase} reasoning={reasoning} elapsedSec={elapsedSec} />
}

/**
 * 内层组件：折叠状态与阶段解耦（完成/终止后仍可展开回看）。
 */
function AgentThinkingLine({ phase, reasoning, elapsedSec }: AgentThinkingProps) {
  const [open, setOpen] = useState(false)
  const prevPhase = useRef<AgentPhase>(phase)

  useEffect(() => {
    // 生成结束：自动收起（用户可再展开）
    if (prevPhase.current === 'thinking' && (phase === 'content' || phase === 'stopped')) {
      setOpen(false)
    }
    prevPhase.current = phase
  }, [phase])

  const live = phase === 'thinking'
  const statusText =
    phase === 'thinking'
      ? `✦ 思考中 · ${elapsedSec.toFixed(1)}s`
      : phase === 'stopped'
        ? '✦ 思考 · 已终止'
        : `✦ 思考 · ~${Math.round(reasoning.length * ZH_TOKEN_RATIO)} token`

  return (
    <div aria-label="AI 思考过程">
      <div
        className="agent-think-line"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            setOpen((current) => !current)
          }
        }}
        aria-expanded={open}
      >
        <span className={live ? 'agent-think-line__st agent-think-line__st--live' : 'agent-think-line__st'}>
          {statusText}
        </span>
        {live && reasoning.length > 0 && (
          <span className="agent-think-line__st">{reasoning.slice(-18)}</span>
        )}
        <span className="agent-think-line__expand">{open ? '收起' : '展开'}</span>
      </div>
      {open && (
        <div className="agent-think-line__body">
          {reasoning.length > 0 ? reasoning : live ? '正在组织思考…' : '（无思考输出）'}
          {live && <span className="caret" />}
        </div>
      )}
    </div>
  )
}

export default AgentThinking
