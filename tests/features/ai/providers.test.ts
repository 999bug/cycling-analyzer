/**
 * AI 服务商预设表测试（AI 接入 v1）。
 * 把关预设表的结构完整性：用户只填 Key 的前提是预设里的地址/模型必须可用。
 */
import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS, getAiProvider } from '@/features/ai/providers'

describe('AI 服务商预设表', () => {
  it('id 唯一且包含用户评审定稿的厂商', () => {
    const ids = AI_PROVIDERS.map((provider) => provider.id)
    expect(new Set(ids).size).toBe(ids.length)
    // 原型评审定稿：预设收敛为这六家（Claude / OpenAI 官方不做预设卡）
    expect(ids).toEqual(['deepseek', 'zhipu', 'kimi', 'openrouter', 'qwen', 'custom'])
  })

  it('非自定义厂商必须内置接口地址与至少一个模型，默认模型在列表内', () => {
    for (const provider of AI_PROVIDERS) {
      if (provider.id === 'custom') {
        expect(provider.baseUrl).toBe('')
        expect(provider.models).toBeNull()
        continue
      }
      expect(provider.baseUrl).toMatch(/^https:\/\/.+\/v\d+$/)
      expect(provider.models).not.toBeNull()
      expect((provider.models ?? []).length).toBeGreaterThan(0)
      expect((provider.models ?? []).some((option) => option.value === provider.defaultModel)).toBe(true)
    }
  })

  it('按 id 取预设；未知 id 返回 undefined', () => {
    expect(getAiProvider('deepseek')?.name).toBe('DeepSeek')
    expect(getAiProvider('qwen')?.baseUrl).toContain('dashscope.aliyuncs.com/compatible-mode')
    expect(getAiProvider('nope')).toBeUndefined()
    expect(getAiProvider(null)).toBeUndefined()
  })
})
