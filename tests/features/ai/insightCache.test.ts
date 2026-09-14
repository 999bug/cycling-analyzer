/**
 * AI 解读缓存测试（insightCache）。
 * 契约：roundtrip、空文本不写、脏数据按空缓存处理、条目上限淘汰最早写入。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCachedInsight, setCachedInsight } from '@/features/ai/insightCache'

const CACHE_KEY = 'cycling-ai-insight-cache'

beforeEach(() => {
  window.localStorage.clear()
})

describe('insightCache', () => {
  it('写入后可读，空文本/空 id 忽略', () => {
    setCachedInsight('act-1', '本次属于节奏爬坡训练。')
    expect(getCachedInsight('act-1')).toBe('本次属于节奏爬坡训练。')

    setCachedInsight('act-2', '   ')
    expect(getCachedInsight('act-2')).toBeUndefined()
    setCachedInsight('', '文本')
    expect(getCachedInsight('')).toBeUndefined()
  })

  it('无缓存/脏数据返回 undefined 而不抛错', () => {
    expect(getCachedInsight('act-1')).toBeUndefined()
    window.localStorage.setItem(CACHE_KEY, '{not json')
    expect(getCachedInsight('act-1')).toBeUndefined()
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ 'act-1': { text: 123, at: '' } }))
    expect(getCachedInsight('act-1')).toBeUndefined()
  })

  it('超过上限时淘汰最早写入的条目', () => {
    for (let i = 0; i < 50; i += 1) {
      setCachedInsight(`act-${i}`, `解读 ${i}`)
    }
    setCachedInsight('act-50', '最新一条')
    expect(getCachedInsight('act-0')).toBeUndefined()
    expect(getCachedInsight('act-50')).toBe('最新一条')
    expect(getCachedInsight('act-25')).toBe('解读 25')
  })
})
