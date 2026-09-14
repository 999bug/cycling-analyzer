/**
 * AI 服务商预设表（AI 接入 v1，规格外延伸功能）。
 *
 * 设计约束（原型评审定稿，2026-09-14）：
 * - 预设厂商内置接口地址与模型参数，用户只需粘贴 Key（配置尽可能少）
 * - 全部走 OpenAI 兼容 chat/completions 接口（一个 adapter 通吃）；
 *   自定义厂商允许填任意 OpenAI 兼容地址（含中转站）
 * - 模型列表以接入时实测为准，随时可在此表增删（预设收敛：Claude / OpenAI
 *   不做预设卡，需要时经「自定义」补——用户指定）
 */

/** AI 服务商标识 */
export type AiProviderId = 'deepseek' | 'zhipu' | 'kimi' | 'openrouter' | 'qwen' | 'custom'

/** 预设模型选项（value 为请求里的 model 参数，label 为展示名） */
export interface AiModelOption {
  /** 模型 ID（请求参数原值） */
  value: string

  /** 展示名（含推荐/免费等标注） */
  label: string
}

/** AI 服务商预设 */
export interface AiProviderPreset {
  /** 服务商标识 */
  id: AiProviderId

  /** 展示名 */
  name: string

  /** 卡片角标（如「性价比」「聚合」；空串不显示） */
  tag: string

  /** 一句话说明 */
  desc: string

  /** OpenAI 兼容接口根地址（custom 为空串，由用户填写） */
  baseUrl: string

  /** 预设模型列表（custom 为 null，模型名手填） */
  models: readonly AiModelOption[] | null

  /** 默认模型（必须在 models 里；custom 为空串） */
  defaultModel: string
}

/**
 * 服务商预设表（顺序即设置页卡片顺序）。
 * 模型名维护提示：DeepSeek 的 deepseek-chat 会随版本升级指向新一代模型，
 * 无需改名；其余厂商发布新模型时在此追加即可。
 */
export const AI_PROVIDERS: readonly AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tag: '性价比',
    desc: '官方 API · OpenAI 兼容',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { value: 'deepseek-chat', label: 'deepseek-chat（推荐）' },
      { value: 'deepseek-reasoner', label: 'deepseek-reasoner（深度思考）' },
    ],
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    tag: '有免费档',
    desc: 'glm-4-flash 免费 · 国内直连',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { value: 'glm-4.5-air', label: 'glm-4.5-air（推荐）' },
      { value: 'glm-4-flash', label: 'glm-4-flash（免费）' },
      { value: 'glm-4.5', label: 'glm-4.5（旗舰）' },
    ],
    defaultModel: 'glm-4.5-air',
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    tag: '',
    desc: 'OpenAI 兼容接口',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { value: 'kimi-k2-0905-preview', label: 'kimi-k2（推荐）' },
      { value: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
      { value: 'moonshot-v1-32k', label: 'moonshot-v1-32k' },
    ],
    defaultModel: 'kimi-k2-0905-preview',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tag: '聚合',
    desc: '一个 Key 用多家模型',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { value: 'deepseek/deepseek-chat-v3.1', label: 'deepseek-chat-v3.1（免费档）' },
      { value: 'openai/gpt-4o-mini', label: 'gpt-4o-mini' },
      { value: 'anthropic/claude-haiku-4.5', label: 'claude-haiku-4.5' },
    ],
    defaultModel: 'deepseek/deepseek-chat-v3.1',
  },
  {
    id: 'qwen',
    name: '通义千问',
    tag: '国内直连',
    desc: '阿里云百炼 · OpenAI 兼容模式',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { value: 'qwen-flash', label: 'qwen-flash（推荐 · 便宜）' },
      { value: 'qwen-plus', label: 'qwen-plus' },
      { value: 'qwen-max', label: 'qwen-max（旗舰）' },
    ],
    defaultModel: 'qwen-flash',
  },
  {
    id: 'custom',
    name: '自定义',
    tag: '',
    desc: '任意 OpenAI 兼容接口 / 中转站',
    baseUrl: '',
    models: null,
    defaultModel: '',
  },
]

/**
 * 按 id 取服务商预设。
 *
 * @param id 服务商标识
 * @returns 预设；未知 id 返回 undefined
 */
export function getAiProvider(id: string | null | undefined): AiProviderPreset | undefined {
  return AI_PROVIDERS.find((provider) => provider.id === id)
}
