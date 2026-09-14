/**
 * AI 配置 store 测试（aiConfigStore）。
 * 核心契约：配置不完整时 resolveAiConfig 返回 null（AI 入口全部隐藏）；
 * 自定义厂商要求地址 + 模型名；持久化落在 localStorage 独立键
 * （不进 Dexie settings 表，因此不会随 JSON 备份导出）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { resolveAiConfig, selectAiReady, useAiConfigStore } from '@/features/ai/aiConfigStore'

const READY = {
  providerId: 'deepseek' as const,
  apiKey: 'sk-test-123456',
  model: 'deepseek-chat',
  customBaseUrl: '',
}

beforeEach(() => {
  window.localStorage.clear()
  useAiConfigStore.setState({ providerId: null, apiKey: '', model: '', customBaseUrl: '' })
})

describe('resolveAiConfig', () => {
  it('未选厂商或缺 Key → null', () => {
    expect(resolveAiConfig({ providerId: null, apiKey: '', model: '', customBaseUrl: '' })).toBeNull()
    expect(resolveAiConfig({ ...READY, apiKey: '  ' })).toBeNull()
  })

  it('预设厂商：地址来自预设表，模型缺省取默认推荐', () => {
    const resolved = resolveAiConfig({ ...READY, model: '' })
    expect(resolved).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-test-123456',
    })
  })

  it('自定义厂商：地址与模型名缺一不可；地址去掉尾斜杠', () => {
    expect(
      resolveAiConfig({ ...READY, providerId: 'custom', customBaseUrl: '', model: 'qwen-max' }),
    ).toBeNull()
    const resolved = resolveAiConfig({
      ...READY,
      providerId: 'custom',
      customBaseUrl: 'https://relay.example.com/v1///',
      model: 'qwen-max',
    })
    expect(resolved).toMatchObject({ baseUrl: 'https://relay.example.com/v1', model: 'qwen-max' })
  })

  it('selectAiReady 与 resolveAiConfig 一致', () => {
    expect(selectAiReady({ ...READY, apiKey: '' })).toBe(false)
    expect(selectAiReady(READY)).toBe(true)
  })
})

describe('aiConfigStore 持久化', () => {
  it('saveConfig 落 localStorage 独立键；clearConfig 清空', () => {
    useAiConfigStore.getState().saveConfig(READY)
    expect(useAiConfigStore.getState().providerId).toBe('deepseek')

    const raw = window.localStorage.getItem('cycling-ai-config')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.apiKey).toBe('sk-test-123456')

    useAiConfigStore.getState().clearConfig()
    expect(useAiConfigStore.getState().providerId).toBeNull()
    expect(useAiConfigStore.getState().apiKey).toBe('')
  })
})
