/**
 * AI 诊断日志模块测试：环形缓冲、持久化往返、脱敏字段与清空。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAiDebugLog,
  hostOf,
  listAiDebugLog,
  logAiDebug,
} from '@/features/ai/aiDebugLog'

beforeEach(() => {
  window.localStorage.clear()
  clearAiDebugLog()
})

function entry(ts: number, overrides: Partial<Parameters<typeof logAiDebug>[0]> = {}) {
  return {
    ts,
    feature: 'segment-name',
    model: 'glm-4.6',
    host: 'open.bigmodel.cn',
    status: 'ok' as const,
    durationMs: 900,
    ...overrides,
  }
}

describe('aiDebugLog', () => {
  it('记录并读取（时间升序保留）', () => {
    logAiDebug(entry(1000))
    logAiDebug(entry(2000, { status: 'error', detail: '请求超时或已取消，请重试' }))

    const log = listAiDebugLog()
    expect(log).toHaveLength(2)
    expect(log[0]?.ts).toBe(1000)
    expect(log[1]).toMatchObject({ status: 'error', detail: '请求超时或已取消，请重试' })
  })

  it('持久化到 localStorage：新读写实例可见', () => {
    logAiDebug(entry(1234))
    // 模块内存镜像被 localStorage 支撑：直接读原始键验证
    const raw = window.localStorage.getItem('cycling-ai-debug-log')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toHaveLength(1)
  })

  it('环形上限 200 条：超出淘汰最旧', () => {
    for (let i = 0; i < 230; i += 1) {
      logAiDebug(entry(i))
    }
    const log = listAiDebugLog()
    expect(log).toHaveLength(200)
    expect(log[0]?.ts).toBe(30)
    expect(log[199]?.ts).toBe(229)
  })

  it('clearAiDebugLog 清空后为空', () => {
    logAiDebug(entry(1))
    clearAiDebugLog()
    expect(listAiDebugLog()).toEqual([])
  })

  it('hostOf 提取域名且不含路径与 Key', () => {
    expect(hostOf('https://api.deepseek.com/chat/completions')).toBe('api.deepseek.com')
    expect(hostOf('not a url')).toBe('unknown')
  })
})
