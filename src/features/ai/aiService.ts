/**
 * AI 功能服务层（AI 接入 v2/v3）：文案、解读的参数组装与编排。
 *
 * 职责：取配置 → 组装请求（aiPrompts）→ 调用（aiClient / useAgentStream）。
 * UI 组件只调这里的函数，不直接拼 prompt 或 fetch。
 *
 * v3 起：流式生成走 *StreamParams 组装器——返回 AgentStartParams 交给
 * useAgentStream().start()，思考与正文 delta 由 hook 分发；非流式
 * chatComplete 保留给连接测试与不支持流式的场景。
 */
import type { Activity } from '@/types/activity'
import { AiRequestError, chatComplete } from '@/features/ai/aiClient'
import { resolveAiConfig } from '@/features/ai/aiConfigStore'
import { useAiConfigStore } from '@/features/ai/aiConfigStore'
import { getAiVendor } from '@/features/ai/providers'
import {
  buildCaptionRequest,
  buildInsightRequest,
  parseCaptionResponse,
  type AiActivityContext,
  type AiCaptionPlatform,
  type AiCaptionResult,
} from '@/features/ai/aiPrompts'
import type { AiRequestConfig } from '@/features/ai/aiClient'
import type { AgentStartParams } from '@/features/ai/useAgentStream'

/** AI 未配置时抛出（UI 层据此展示引导提示，理论上入口已隐藏） */
const NOT_CONFIGURED_MESSAGE = 'AI 服务未配置：到「更多 → AI 服务」添加并启用一个供应商配置'

/**
 * 从配置 store 读取生效配置（含厂商附加请求头）；未配置抛 AiRequestError。
 */
function requireAiConfig(): AiRequestConfig {
  const resolved = resolveAiConfig(useAiConfigStore.getState())
  if (resolved === null) {
    throw new AiRequestError(NOT_CONFIGURED_MESSAGE)
  }
  return {
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    extraHeaders: getAiVendor(resolved.vendorId)?.extraHeaders,
  }
}

/** 读取用户设置的单次输出上限（token，含思考过程） */
function maxOutputTokens(): number {
  return useAiConfigStore.getState().maxOutputTokens
}

/**
 * 组装发布文案的流式请求参数（Share Studio「AI 生成文案」）。
 *
 * @param activity 活动摘要
 * @param platform 目标平台
 * @param context 训练配置上下文
 * @throws AiRequestError 未配置
 */
export function captionStreamParams(
  activity: Activity,
  platform: AiCaptionPlatform,
  context: AiActivityContext = {},
): AgentStartParams {
  const config = requireAiConfig()
  const request = buildCaptionRequest(activity, platform, context)
  return {
    config,
    system: request.system,
    user: request.user,
    maxTokens: maxOutputTokens(),
    temperature: request.temperature,
  }
}

/**
 * 组装骑行解读的流式请求参数（详情页「AI 解读」）。
 *
 * @param activity 活动摘要
 * @param context 训练配置上下文
 * @throws AiRequestError 未配置
 */
export function insightStreamParams(activity: Activity, context: AiActivityContext = {}): AgentStartParams {
  const config = requireAiConfig()
  const request = buildInsightRequest(activity, context)
  return {
    config,
    system: request.system,
    user: request.user,
    maxTokens: maxOutputTokens(),
    temperature: request.temperature,
  }
}

/**
 * 生成发布文案（非流式一次性版本；流式走 captionStreamParams + useAgentStream）。
 *
 * @param activity 活动摘要
 * @param platform 目标平台
 * @param context 训练配置上下文
 * @param signal 外部中断信号（可选）
 * @returns 文案结果（xhs 含标题）
 * @throws AiRequestError 未配置或请求失败（message 可直接展示）
 */
export async function generateShareCaption(
  activity: Activity,
  platform: AiCaptionPlatform,
  context: AiActivityContext = {},
  signal?: AbortSignal,
): Promise<AiCaptionResult> {
  const config = requireAiConfig()
  const request = buildCaptionRequest(activity, platform, context)
  const text = await chatComplete(config, { ...request, signal, maxTokens: maxOutputTokens() })
  return parseCaptionResponse(platform, text)
}

/**
 * 生成骑行解读（非流式一次性版本；流式走 insightStreamParams + useAgentStream）。
 *
 * @param activity 活动摘要
 * @param context 训练配置上下文
 * @param signal 外部中断信号（可选）
 * @returns 解读文本（1~2 句）
 * @throws AiRequestError 未配置或请求失败
 */
export async function generateAiInsight(
  activity: Activity,
  context: AiActivityContext = {},
  signal?: AbortSignal,
): Promise<string> {
  const config = requireAiConfig()
  const request = buildInsightRequest(activity, context)
  return chatComplete(config, { ...request, signal, maxTokens: maxOutputTokens() })
}
