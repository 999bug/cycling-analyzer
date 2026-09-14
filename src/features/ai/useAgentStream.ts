/**
 * agent 式生成 hook（AI 接入 v3）。
 *
 * 封装流式请求的状态机：思考中 → 正文输出中 → 完成 / 已终止 / 出错，
 * 并累计思考与正文文本、计时。终止走 AbortController——已收到部分保留
 * （phase = stopped，content / reasoning 停在断点），计费按实际用量。
 *
 * UI 契约（v3 原型定稿）：
 * - thinking 阶段展示思考卡（AgentThinking），正文开始后自动折叠
 * - content 阶段把 content 流式渲染进目标区域
 * - done / stopped 时用最终 content 替换目标内容；error 展示可读原因
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { streamChatComplete, type AiRequestConfig } from '@/features/ai/aiClient'

/** agent 生成阶段 */
export type AgentPhase = 'idle' | 'thinking' | 'content' | 'done' | 'stopped' | 'error'

/** start 的请求参数（config 来自 aiService 的 *StreamParams 组装器） */
export interface AgentStartParams {
  config: AiRequestConfig
  system: string
  user: string
  maxTokens: number
  temperature: number
}

/** 生成结束结果（onFinish 回调携带；phase ∈ done/stopped/error） */
export interface AgentOutcome {
  phase: 'done' | 'stopped' | 'error'
  /** 正文（stopped 时为断点部分，可能为空串） */
  content: string
  /** 思考过程 */
  reasoning: string
  /** 出错原因（phase = error 时有值） */
  error: string
}

/** 生成结束回调（异步事件中调用 setState 合法；请勿在渲染期调用） */
export type AgentFinishCallback = (outcome: AgentOutcome) => void

/** agent 流式状态与控制 */
export interface AgentStream {
  phase: AgentPhase
  /** 思考过程累计文本（流式追加） */
  reasoning: string
  /** 正文累计文本（流式追加；stopped 时为断点部分） */
  content: string
  /** 出错原因（phase = error 时有值，可直接展示） */
  error: string
  /** 已耗时（秒，0.1 粒度） */
  elapsedSec: number

  /** 启动一次生成（进行中再次调用会先终止上一次） */
  start(params: AgentStartParams, onFinish?: AgentFinishCallback): void

  /** 终止当前生成（已收到部分保留在 content / reasoning） */
  stop(): void
}

/** 0.1 秒粒度的计时步长（毫秒） */
const ELAPSED_TICK_MS = 100

/**
 * agent 式流式生成 hook。
 */
export function useAgentStream(): AgentStream {
  const [phase, setPhase] = useState<AgentPhase>('idle')
  const [reasoning, setReasoning] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [elapsedSec, setElapsedSec] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** 卸载时兜底断流（组件关闭不留下继续计费的请求） */
  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
      }
    },
    [],
  )

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const start = useCallback(
    (params: AgentStartParams, onFinish?: AgentFinishCallback) => {
    // 进行中再次启动：先终止上一次（部分结果已被组件消费或丢弃）
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('thinking')
    setReasoning('')
    setContent('')
    setError('')
    setElapsedSec(0)
    timerRef.current = setInterval(() => {
      setElapsedSec((current) => Math.round((current + ELAPSED_TICK_MS / 1000) * 10) / 10)
    }, ELAPSED_TICK_MS)

    let sawContent = false
    void streamChatComplete(
      params.config,
      {
        system: params.system,
        user: params.user,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
        signal: controller.signal,
      },
      {
        onReasoning: (delta) => setReasoning((current) => current + delta),
        onContent: (delta) => {
          if (!sawContent) {
            sawContent = true
            setPhase('content')
          }
          setContent((current) => current + delta)
        },
      },
    )
      .then((result) => {
        clearTimer()
        const outcome: AgentOutcome = {
          phase: controller.signal.aborted ? 'stopped' : 'done',
          content: result.content,
          reasoning: result.reasoning,
          error: '',
        }
        setPhase(outcome.phase)
        onFinish?.(outcome)
      })
      .catch((err: unknown) => {
        clearTimer()
        if (controller.signal.aborted) {
          setPhase('stopped')
          onFinish?.({ phase: 'stopped', content: '', reasoning: '', error: '' })
          return
        }
        const message = err instanceof Error ? err.message : '生成失败，请重试'
        setPhase('error')
        setError(message)
        onFinish?.({ phase: 'error', content: '', reasoning: '', error: message })
      })
  },
    [clearTimer],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { phase, reasoning, content, error, elapsedSec, start, stop }
}
