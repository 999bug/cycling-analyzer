/**
 * AI 功能服务层（AI 接入 v1）：文案生成与解读生成的编排。
 *
 * 职责：取配置 → 组装请求（aiPrompts）→ 调用（aiClient）→ 解析。
 * UI 组件只调这里的函数，不直接拼 prompt 或 fetch。
 */
import type { Activity } from '@/types/activity'
import { AiRequestError, chatComplete } from '@/features/ai/aiClient'
import { resolveAiConfig } from '@/features/ai/aiConfigStore'
import { useAiConfigStore } from '@/features/ai/aiConfigStore'
import {
  buildCaptionRequest,
  buildInsightRequest,
  parseCaptionResponse,
  type AiActivityContext,
  type AiCaptionPlatform,
  type AiCaptionResult,
} from '@/features/ai/aiPrompts'

/** AI 未配置时抛出（UI 层据此展示引导提示，理论上入口已隐藏） */
const NOT_CONFIGURED_MESSAGE = 'AI 服务未配置：到「更多 → AI 服务」选择厂商并粘贴 Key'

/**
 * 从配置 store 读取就绪配置；未配置抛 AiRequestError（统一错误通道）。
 */
function requireAiConfig() {
  const resolved = resolveAiConfig(useAiConfigStore.getState())
  if (resolved === null) {
    throw new AiRequestError(NOT_CONFIGURED_MESSAGE)
  }
  return resolved
}

/**
 * 生成发布文案（Share Studio「AI 生成」按钮）。
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
  const text = await chatComplete(config, { ...request, signal })
  return parseCaptionResponse(platform, text)
}

/**
 * 生成骑行解读（详情页 AI 解读）。
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
  return chatComplete(config, { ...request, signal })
}
