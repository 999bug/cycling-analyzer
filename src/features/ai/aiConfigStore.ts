/**
 * AI 供应商配置 store（zustand + persist，AI 接入 v2：cc-switch 式多配置）。
 *
 * **刻意不进 Dexie settings 表**（硬约束，2026-09-14）：设置表的键值对会被
 * 「导出数据」整表写进 JSON 备份文件（exportImport 的 `db.settings.toArray()`），
 * API Key 属于私密凭据，绝不能跟着备份文件走。故独立存 localStorage
 * （persist key：cycling-ai-config），仅存本机。
 *
 * v2 数据模型：profiles 数组（多套供应商配置）+ activeProfileId（当前生效），
 * 「启用」即切换 activeProfileId，各 AI 功能入口经 resolveAiConfig 取生效配置。
 * v1 单配置数据经 persist migrate 自动搬迁成 profiles（Key 不丢）。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getAiVendor } from '@/features/ai/providers'

/** 一套供应商配置（列表里的一条） */
export interface AiProfile {
  /** 配置 id（毫秒时间戳，本机唯一即可） */
  id: string

  /** 展示名（用户可改，如「OpenRouter 免费档」） */
  name: string

  /** 供应商模板 id（providers 表里的 id；custom = 手填中转） */
  vendorId: string

  /** OpenAI 兼容接口根地址（保存时已归一化：去尾斜杠、custom 补 /v1） */
  baseUrl: string

  /** API Key（仅存本机浏览器） */
  apiKey: string

  /** 模型 ID */
  model: string
}

/** 已就绪的 AI 请求配置（resolveAiConfig 返回） */
export interface ResolvedAiConfig {
  /** 生效配置 id */
  profileId: string

  /** 供应商模板 id（aiClient 据此合并厂商附加请求头） */
  vendorId: string

  /** OpenAI 兼容接口根地址 */
  baseUrl: string

  /** API Key */
  apiKey: string

  /** 模型 ID */
  model: string
}

/** AI 配置 store 状态与 actions */
export interface AiConfigState {
  /** 全部已添加的供应商配置 */
  profiles: AiProfile[]

  /** 当前生效配置 id（null = 未启用任何配置） */
  activeProfileId: string | null

  /**
   * 单次生成输出上限（token，含思考过程；v4 评审定稿默认 10000）。
   * 到达即截断并提示——防失控调用的硬性省钱闸，按实际用量计费。
   */
  maxOutputTokens: number

  /** 添加配置（返回新配置 id） */
  addProfile(profile: Omit<AiProfile, 'id'>): string

  /** 更新配置（按 id 覆盖传入字段） */
  updateProfile(id: string, patch: Partial<Omit<AiProfile, 'id'>>): void

  /** 删除配置；删到当前生效配置时自动切到剩余第一条 */
  removeProfile(id: string): void

  /** 启用某配置（切换 activeProfileId） */
  setActiveProfile(id: string): void

  /** 设置单次输出上限（设置页，立即生效并持久化） */
  setMaxOutputTokens(tokens: number): void
}

/** 输出上限默认值（v4 评审定稿：默认 1 万 token） */
export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000

/** 输出上限允许范围（低于 200 生成不出正文，高于 64000 多数模型也不支持） */
export const MIN_MAX_OUTPUT_TOKENS = 200
export const MAX_MAX_OUTPUT_TOKENS = 64_000

/** 把任意输入收敛为合法的输出上限（设置页输入框脏数据兜底） */
export function clampMaxOutputTokens(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_OUTPUT_TOKENS
  }
  return Math.min(MAX_MAX_OUTPUT_TOKENS, Math.max(MIN_MAX_OUTPUT_TOKENS, Math.round(value)))
}

/** persist 版本号（v0 = v1 单配置结构，v1 = v2 profiles 结构） */
const PERSIST_VERSION = 1

/** AI 配置 store 实例（persist key：cycling-ai-config） */
export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set) => ({
      profiles: [],
      activeProfileId: null,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      addProfile: (profile) => {
        // 同一毫秒内可能连续添加多条，时间戳后必须拼随机段保证唯一
        const id = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        set((state) => ({
          profiles: [...state.profiles, { ...profile, id }],
          // 首个配置自动启用（后续添加不打扰当前生效配置）
          activeProfileId: state.activeProfileId ?? id,
        }))
        return id
      },
      updateProfile: (id, patch) =>
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === id ? { ...profile, ...patch } : profile,
          ),
        })),
      removeProfile: (id) =>
        set((state) => {
          const profiles = state.profiles.filter((profile) => profile.id !== id)
          const activeProfileId =
            state.activeProfileId === id ? (profiles[0]?.id ?? null) : state.activeProfileId
          return { profiles, activeProfileId }
        }),
      setActiveProfile: (id) => set({ activeProfileId: id }),
      setMaxOutputTokens: (tokens) => set({ maxOutputTokens: clampMaxOutputTokens(tokens) }),
    }),
    {
      name: 'cycling-ai-config',
      version: PERSIST_VERSION,
      // v1 单配置 { providerId, apiKey, model, customBaseUrl } → v2 profiles
      migrate: (persisted) => {
        const legacy = persisted as {
          providerId?: string | null
          apiKey?: string
          model?: string
          customBaseUrl?: string
        }
        if (
          legacy !== null &&
          typeof legacy === 'object' &&
          typeof legacy.providerId === 'string' &&
          typeof legacy.apiKey === 'string' &&
          legacy.apiKey.length > 0
        ) {
          const vendor = getAiVendor(legacy.providerId)
          const baseUrl =
            legacy.providerId === 'custom'
              ? (legacy.customBaseUrl ?? '').trim()
              : (vendor?.baseUrl ?? '')
          const profile: AiProfile = {
            id: 'ai-migrated',
            name: vendor?.name ?? '自定义',
            vendorId: legacy.providerId,
            baseUrl,
            apiKey: legacy.apiKey,
            model: (legacy.model ?? vendor?.models[0] ?? '').trim(),
          }
          return { profiles: [profile], activeProfileId: profile.id }
        }
        return { profiles: [], activeProfileId: null }
      },
    },
  ),
)

/**
 * 归一化接口地址：去尾斜杠；自定义（无路径版本号）时补 /v1。
 * 预设厂商的地址来自模板，视为已正确。
 *
 * @param rawUrl 用户输入的地址
 * @param isCustom 是否自定义模板
 */
export function normalizeAiBaseUrl(rawUrl: string, isCustom: boolean): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '')
  if (!isCustom || trimmed.length === 0 || /\/v\d+$/.test(trimmed)) {
    return trimmed
  }
  return `${trimmed}/v1`
}

/**
 * 判定配置是否可用并归一为请求配置。
 *
 * @param state AI 配置 store 状态
 * @returns 生效配置；未启用/配置不完整时 null
 */
export function resolveAiConfig(state: {
  profiles: AiProfile[]
  activeProfileId: string | null
}): ResolvedAiConfig | null {
  const active = state.profiles.find((profile) => profile.id === state.activeProfileId)
  if (active === undefined) {
    return null
  }
  if (
    active.apiKey.trim().length === 0 ||
    active.baseUrl.trim().length === 0 ||
    active.model.trim().length === 0
  ) {
    return null
  }
  return {
    profileId: active.id,
    vendorId: active.vendorId,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
  }
}

/** 便捷选择器：当前配置是否就绪（控制各 AI 入口的显隐） */
export function selectAiReady(state: AiConfigState): boolean {
  return resolveAiConfig(state) !== null
}
