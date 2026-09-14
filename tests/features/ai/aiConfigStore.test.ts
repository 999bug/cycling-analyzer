/**
 * AI 供应商配置 store 测试（aiConfigStore，v2 多配置）。
 * 核心契约：profiles + activeProfileId；生效配置不完整时 resolveAiConfig
 * 返回 null（AI 入口全部隐藏）；自定义地址自动补 /v1；v1 单配置数据经
 * migrate 搬迁为 profiles（Key 不丢）；持久化落 localStorage 独立键。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampMaxOutputTokens,
  DEFAULT_MAX_OUTPUT_TOKENS,
  normalizeAiBaseUrl,
  resolveAiConfig,
  selectAiReady,
  useAiConfigStore,
  type AiProfile,
} from '@/features/ai/aiConfigStore'

const PROFILE: Omit<AiProfile, 'id'> = {
  name: 'OpenRouter 免费档',
  vendorId: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-test-123456',
  model: 'inclusionai/ling-3.0-flash-vl:free',
}

/** 添加一条配置并返回其 id（首个配置自动启用） */
function addReadyProfile(): string {
  return useAiConfigStore.getState().addProfile(PROFILE)
}

beforeEach(() => {
  window.localStorage.clear()
  useAiConfigStore.setState({ profiles: [], activeProfileId: null })
})

describe('resolveAiConfig', () => {
  it('无配置 / 未启用 / 字段缺失 → null', () => {
    expect(resolveAiConfig({ profiles: [], activeProfileId: null })).toBeNull()
    expect(resolveAiConfig({ profiles: [{ ...PROFILE, id: 'a' }], activeProfileId: null })).toBeNull()
    expect(
      resolveAiConfig({
        profiles: [{ ...PROFILE, id: 'a', apiKey: '' }],
        activeProfileId: 'a',
      }),
    ).toBeNull()
  })

  it('生效配置完整 → 归一返回（含 vendorId）', () => {
    const id = addReadyProfile()
    expect(resolveAiConfig(useAiConfigStore.getState())).toEqual({
      profileId: id,
      vendorId: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test-123456',
      model: 'inclusionai/ling-3.0-flash-vl:free',
    })
    expect(selectAiReady(useAiConfigStore.getState())).toBe(true)
  })
})

describe('normalizeAiBaseUrl', () => {
  it('自定义地址补 /v1、去尾斜杠；预设地址原样保留', () => {
    expect(normalizeAiBaseUrl('https://relay.example.com/api///', true)).toBe(
      'https://relay.example.com/api/v1',
    )
    expect(normalizeAiBaseUrl('https://relay.example.com/v1/', true)).toBe('https://relay.example.com/v1')
    expect(normalizeAiBaseUrl('https://api.deepseek.com/v1', false)).toBe('https://api.deepseek.com/v1')
  })
})

describe('多配置管理', () => {
  it('添加的首个配置自动启用；启用切换 activeProfileId', () => {
    const first = useAiConfigStore.getState().addProfile(PROFILE)
    expect(useAiConfigStore.getState().activeProfileId).toBe(first)

    const second = useAiConfigStore.getState().addProfile({
      ...PROFILE,
      name: 'DeepSeek 官方',
      vendorId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    })
    expect(useAiConfigStore.getState().activeProfileId).toBe(first)

    useAiConfigStore.getState().setActiveProfile(second)
    expect(useAiConfigStore.getState().activeProfileId).toBe(second)
    expect(resolveAiConfig(useAiConfigStore.getState())?.model).toBe('deepseek-chat')
  })

  it('删除生效配置时自动切到剩余第一条', () => {
    const first = useAiConfigStore.getState().addProfile(PROFILE)
    const second = useAiConfigStore.getState().addProfile({ ...PROFILE, name: '第二条' })
    useAiConfigStore.getState().setActiveProfile(second)

    useAiConfigStore.getState().removeProfile(second)
    expect(useAiConfigStore.getState().activeProfileId).toBe(first)

    useAiConfigStore.getState().removeProfile(first)
    expect(useAiConfigStore.getState().profiles).toHaveLength(0)
    expect(useAiConfigStore.getState().activeProfileId).toBeNull()
  })

  it('updateProfile 只覆盖传入字段', () => {
    const id = addReadyProfile()
    useAiConfigStore.getState().updateProfile(id, { model: 'deepseek/deepseek-chat-v3.1:free' })
    const profile = useAiConfigStore.getState().profiles.find((p) => p.id === id)
    expect(profile?.model).toBe('deepseek/deepseek-chat-v3.1:free')
    expect(profile?.apiKey).toBe('sk-or-test-123456')
  })
})

describe('持久化与迁移', () => {
  it('profiles 落 localStorage 独立键（不进 settings 表）', () => {
    addReadyProfile()
    const raw = window.localStorage.getItem('cycling-ai-config')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.profiles).toHaveLength(1)
  })

  it('migrate：v1 单配置（含 Key）搬迁为 profiles 且自动启用', async () => {
    window.localStorage.setItem(
      'cycling-ai-config',
      JSON.stringify({
        state: { providerId: 'deepseek', apiKey: 'sk-legacy-key', model: 'deepseek-chat', customBaseUrl: '' },
        version: 0,
      }),
    )
    // persist 在 rehydrate 时发现版本 0 < 1，走 migrate 搬迁
    await useAiConfigStore.persist.rehydrate()
    const state = useAiConfigStore.getState()
    expect(state.profiles).toHaveLength(1)
    expect(state.profiles[0].apiKey).toBe('sk-legacy-key')
    expect(state.profiles[0].baseUrl).toBe('https://api.deepseek.com/v1')
    expect(state.profiles[0].vendorId).toBe('deepseek')
    expect(state.activeProfileId).toBe(state.profiles[0].id)
  })

  it('migrate：v1 数据无 Key / 无 providerId → 空配置', async () => {
    window.localStorage.setItem(
      'cycling-ai-config',
      JSON.stringify({ state: { providerId: null, apiKey: '', model: '', customBaseUrl: '' }, version: 0 }),
    )
    await useAiConfigStore.persist.rehydrate()
    expect(useAiConfigStore.getState().profiles).toHaveLength(0)
  })
})

describe('单次输出上限（v4）', () => {
  it('默认 9999；setter 收敛非法输入', () => {
    expect(useAiConfigStore.getState().maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)

    useAiConfigStore.getState().setMaxOutputTokens(4000)
    expect(useAiConfigStore.getState().maxOutputTokens).toBe(4000)

    useAiConfigStore.getState().setMaxOutputTokens(1)
    expect(useAiConfigStore.getState().maxOutputTokens).toBe(200)

    useAiConfigStore.getState().setMaxOutputTokens(Number.NaN)
    expect(useAiConfigStore.getState().maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
  })

  it('clampMaxOutputTokens 边界', () => {
    expect(clampMaxOutputTokens(64000)).toBe(64000)
    expect(clampMaxOutputTokens(65000)).toBe(64000)
    expect(clampMaxOutputTokens(100)).toBe(200)
  })

  it('输出上限随 profiles 一起持久化', () => {
    addReadyProfile()
    useAiConfigStore.getState().setMaxOutputTokens(20000)
    const raw = JSON.parse(window.localStorage.getItem('cycling-ai-config') as string)
    expect(raw.state.maxOutputTokens).toBe(20000)
  })
})
