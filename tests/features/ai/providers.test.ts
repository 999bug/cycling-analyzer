/**
 * AI 供应商预设库测试（AI 接入 v2）。
 * 把关预设库的结构完整性：用户只填 Key 的前提是预设里的地址/模型必须可用；
 * 常用模板 + 预设库合并查找；Claude 的浏览器直连专用头必须随预设携带。
 */
import { describe, expect, it } from 'vitest'
import {
  AI_COMMON_TEMPLATES,
  AI_PRESET_LIBRARY,
  CUSTOM_VENDOR_ID,
  getAiVendor,
} from '@/features/ai/providers'

describe('常用模板', () => {
  it('8 张模板卡，含评审定稿的 OpenAI 与 Claude', () => {
    const ids = AI_COMMON_TEMPLATES.map((vendor) => vendor.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'deepseek',
      'zhipu',
      'kimi',
      'openrouter',
      'openai',
      'anthropic',
      'qwen',
      'custom',
    ])
  })

  it('非自定义模板必须内置地址与默认模型；自定义地址为空', () => {
    for (const vendor of AI_COMMON_TEMPLATES) {
      if (vendor.id === CUSTOM_VENDOR_ID) {
        expect(vendor.baseUrl).toBe('')
        expect(vendor.models).toHaveLength(0)
        continue
      }
      expect(vendor.baseUrl).toMatch(/^https:\/\//)
      expect(vendor.models.length).toBeGreaterThan(0)
    }
  })

  it('Claude 模板携带浏览器直连专用请求头', () => {
    const anthropic = AI_COMMON_TEMPLATES.find((vendor) => vendor.id === 'anthropic')
    expect(anthropic?.extraHeaders).toMatchObject({
      'anthropic-dangerous-direct-browser-access': 'true',
    })
  })
})

describe('预设库（cc-switch 同源）', () => {
  it('59 条、id 唯一、分类合法', () => {
    const ids = AI_PRESET_LIBRARY.map((vendor) => vendor.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(AI_PRESET_LIBRARY.length).toBe(59)
    for (const vendor of AI_PRESET_LIBRARY) {
      expect(['official', 'aggregator', 'relay']).toContain(vendor.category)
      expect(vendor.baseUrl).toMatch(/^https:\/\//)
    }
  })

  it('预设库覆盖常用模板的 id（搜索面板能搜到常用厂商）', () => {
    for (const template of AI_COMMON_TEMPLATES) {
      if (template.id === CUSTOM_VENDOR_ID) {
        continue
      }
      expect(AI_PRESET_LIBRARY.some((vendor) => vendor.id === template.id)).toBe(true)
    }
  })
})

describe('getAiVendor 合并查找', () => {
  it('常用模板与预设库都能查到；未知 id 返回 undefined', () => {
    expect(getAiVendor('deepseek')?.name).toBe('DeepSeek')
    expect(getAiVendor('siliconflow')?.category).toBe('official')
    expect(getAiVendor('qwen')?.baseUrl).toContain('dashscope.aliyuncs.com/compatible-mode')
    expect(getAiVendor('nope')).toBeUndefined()
    expect(getAiVendor(null)).toBeUndefined()
  })
})
