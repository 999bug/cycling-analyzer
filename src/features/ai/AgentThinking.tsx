/**
 * 思考过程卡（agent 式生成的通用 UI，AI 接入 v3）。
 *
 * 行为（v3 原型定稿）：
 * - thinking 阶段展开、流式追加思考文本，头部实时显示耗时；
 * - 首段正文到达时**自动折叠**（用户可再点开回看）；
 * - done / stopped 停止计时，状态标注思考 token 估算或「已终止」。
 *
 * token 估算：中文 1 字 ≈ 0.6 token（展示用粗估，不代表计费口径）。
 */
import { useEffect, useRef, useState } from 'react'
import type { AgentPhase } from '@/features/ai/useAgentStream'
import '@/features/ai/ai.css'

/** 思考卡 props */
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
 * 思考过程卡组件（phase = idle 时返回 null）。
 *
 * @param props 组件参数
 */
function AgentThinking({ phase, reasoning, elapsedSec }: AgentThinkingProps) {
  if (phase === 'idle') {
    return null
  }
  return <AgentThinkingInner phase={phase} reasoning={reasoning} elapsedSec={elapsedSec} />
}

/**
 * 内层组件：折叠状态在「思考 → 正文」转换时自动收起一次，
 * 之后完全由用户手动控制（不能放在外层条件渲染里丢状态）。
 */
function AgentThinkingInner({ phase, reasoning, elapsedSec }: AgentThinkingProps) {
  const [collapsed, setCollapsed] = useState(false)
  const prevPhase = useRef<AgentPhase>(phase)

  useEffect(() => {
    // 思考完毕、正文开始：自动折叠一次（v3 定稿行为）
    if (prevPhase.current === 'thinking' && phase === 'content') {
      setCollapsed(true)
    }
    prevPhase.current = phase
  }, [phase])

  const live = phase === 'thinking'
  const statusText =
    phase === 'thinking'
      ? `思考中 · ${elapsedSec.toFixed(1)}s`
      : phase === 'stopped'
        ? '已终止'
        : `已完成 · ~${Math.round(reasoning.length * ZH_TOKEN_RATIO)} token`

  return (
    <div
      className={collapsed ? 'agent-think agent-think--collapsed' : 'agent-think'}
      aria-label="AI 思考过程"
    >
      <div
        className="agent-think__head"
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            setCollapsed((current) => !current)
          }
        }}
      >
        <span className="agent-think__title">思考过程</span>
        <span className={live ? 'agent-think__status agent-think__status--live' : 'agent-think__status'}>
          {statusText}
        </span>
        <span className="agent-think__toggle">{collapsed ? '展开' : '收起'}</span>
      </div>
      {!collapsed && (
        <div className="agent-think__body">
          {reasoning.length > 0 ? reasoning : live ? '正在组织思考…' : '（无思考输出）'}
          {live && <span className="agent-think__caret" />}
        </div>
      )}
    </div>
  )
}

export default AgentThinking
