/**
 * AI 服务配置 store（zustand + persist）。
 *
 * **刻意不进 Dexie settings 表**（硬约束，2026-09-14）：设置表的键值对会被
 * 「导出数据」整表写进 JSON 备份文件（exportImport 的 `db.settings.toArray()`），
 * API Key 属于私密凭据，绝不能跟着备份文件走。故独立存 localStorage
 * （persist key：cycling-ai-config），仅存本机。
 *
 * 配置完整性判定见 resolveAiConfig：未选厂商 / 缺 Key / 自定义缺地址或模型名
 * 时视为未配置，所有 AI 功能入口隐藏或降级提示（默认关闭，按需开启）。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getAiProvider, type AiProviderId } from '@/features/ai/providers'

/** 已就绪的 AI 请求配置（resolveAiConfig 返回） */
export interface ResolvedAiConfig {
  /** 服务商标识 */
  providerId: AiProviderId

  /** OpenAI 兼容接口根地址（预设厂商来自预设表，custom 来自用户填写） */
  baseUrl: string

  /** API Key（仅存本机浏览器） */
  apiKey: string

  /** 模型 ID */
  model: string
}

/** AI 配置 store 状态与 actions */
export interface AiConfigState {
  /** 选中的服务商（null = 未配置过） */
  providerId: AiProviderId | null

  /** API Key（password 输入；仅存本机） */
  apiKey: string

  /** 模型 ID（预设厂商为预设列表里的值，custom 为手填） */
  model: string

  /** 自定义接口地址（仅 custom 使用） */
  customBaseUrl: string

  /** 保存配置（设置页「保存配置」提交，整体覆盖） */
  saveConfig(patch: {
    providerId: AiProviderId
    apiKey: string
    model: string
    customBaseUrl: string
  }): void

  /** 清空配置（删除 Key 与全部字段） */
  clearConfig(): void
}

/** AI 配置 store 实例（persist key：cycling-ai-config） */
export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set) => ({
      providerId: null,
      apiKey: '',
      model: '',
      customBaseUrl: '',
      saveConfig: (patch) => set(patch),
      clearConfig: () =>
        set({ providerId: null, apiKey: '', model: '', customBaseUrl: '' }),
    }),
    { name: 'cycling-ai-config' },
  ),
)

/**
 * 判定配置是否可用并归一为请求配置。
 *
 * @param state AI 配置 store 状态（或其持久化子集）
 * @returns 就绪配置；未配置/不完整时 null
 */
export function resolveAiConfig(state: {
  providerId: AiProviderId | null
  apiKey: string
  model: string
  customBaseUrl: string
}): ResolvedAiConfig | null {
  if (state.providerId === null) {
    return null
  }
  const apiKey = state.apiKey.trim()
  if (apiKey.length === 0) {
    return null
  }
  const preset = getAiProvider(state.providerId)
  if (preset === undefined) {
    return null
  }
  if (preset.id === 'custom') {
    const baseUrl = state.customBaseUrl.trim().replace(/\/+$/, '')
    const model = state.model.trim()
    if (baseUrl.length === 0 || model.length === 0) {
      return null
    }
    return { providerId: preset.id, baseUrl, apiKey, model }
  }
  return {
    providerId: preset.id,
    baseUrl: preset.baseUrl,
    apiKey,
    model: state.model.trim() || preset.defaultModel,
  }
}

/** 便捷选择器：当前配置是否就绪（控制各 AI 入口的显隐；参数为配置子集，便于测试） */
export function selectAiReady(state: {
  providerId: AiProviderId | null
  apiKey: string
  model: string
  customBaseUrl: string
}): boolean {
  return resolveAiConfig(state) !== null
}
