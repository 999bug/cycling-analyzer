/**
 * AI 请求客户端（OpenAI 兼容 chat/completions，AI 接入 v2）。
 *
 * 浏览器直连服务商（BYOK 架构，无后端代理）：Key 只存本机浏览器，
 * 请求从用户浏览器直接发往服务商接口。个别服务商可能不开浏览器 CORS，
 * fetch 抛 TypeError 时给出指向「自定义兼容接口/中转站」的提示。
 *
 * v2 增强：
 * - 预设级附加请求头（Claude 官方 API 浏览器直连必须带
 *   anthropic-dangerous-direct-browser-access，经 AiRequestConfig.extraHeaders 合并）
 * - 「获取模型列表」：GET {baseUrl}/models，供设置页填充模型下拉
 * - 连接测试以 HTTP 200 为准（思考型模型可能把极小 max_tokens 全花在
 *   reasoning 上导致 content 为空，200 即代表 Key/地址/模型可用）
 * - OpenRouter 特有的「HTTP 200 + 错误体」透出真实原因
 *
 * 上行数据边界（硬约束）：调用方只能传聚合指标文案（见 aiPrompts），
 * 严禁把 GPS 轨迹点、逐点心率等原始序列塞进 prompt。
 */

/** 单次请求超时（毫秒）：文案生成是小请求，30 秒足够覆盖慢模型 */
import { hostOf, logAiDebug } from '@/features/ai/aiDebugLog'

const REQUEST_TIMEOUT_MS = 30_000

/** 连接测试的最大输出 token（思考型模型会先产出 reasoning，需留余量） */
const TEST_MAX_TOKENS = 64

/** 连接测试的用户消息（要求极短回复，控制成本） */
const TEST_USER_MESSAGE = '请只回复两个字：正常'

/** AI 请求配置（来自 resolveAiConfig + 预设合并） */
export interface AiRequestConfig {
  /** OpenAI 兼容接口根地址（如 https://api.deepseek.com/v1） */
  baseUrl: string

  /** API Key */
  apiKey: string

  /** 模型 ID */
  model: string

  /** 厂商附加请求头（如 Claude 的浏览器直连专用头；可选） */
  extraHeaders?: Record<string, string>
}

/** 一次对话补全的参数 */
export interface ChatCompleteOptions {
  /** 系统提示（角色与硬性约束） */
  system: string

  /** 用户消息（数据 + 任务） */
  user: string

  /** 最大输出 token */
  maxTokens: number

  /** 采样温度（0~1；文案 0.7 / 解读 0.5） */
  temperature: number

  /** 超时毫秒数（缺省 REQUEST_TIMEOUT_MS） */
  timeoutMs?: number

  /** 外部中断信号（可选，弹窗关闭等场景） */
  signal?: AbortSignal

  /**
   * 功能标签（可选，诊断日志用）：segment-name / share-caption /
   * insight-enhance …缺省记为 unknown。标签只进本机诊断日志，不参与请求。
   */
  featureTag?: string

  /**
   * 允许空正文（连接测试用）：思考型模型把 max_tokens 花在 reasoning 上时
   * content 可能为空，HTTP 200 依然代表 Key/地址/模型可用
   */
  emptyContentOk?: boolean
}

/** chat/completions 返回的 message 结构（只取需要的字段） */
interface ChatChoiceMessage {
  content?: string | null
  reasoning?: string | null
  reasoning_content?: string | null
}

/** chat/completions 响应体（只声明解析用到的字段） */
interface ChatCompletionResponse {
  choices?: Array<{ message?: ChatChoiceMessage; finish_reason?: string }>
  error?: { message?: string; code?: number | string }
}

/** OpenAI 兼容 /models 响应体 */
interface ModelsResponse {
  data?: Array<{ id?: string }>
  error?: { message?: string }
}

/** AI 请求失败（message 为可直接展示给用户的中文原因） */
export class AiRequestError extends Error {
  /**
   * @param message 用户可读的失败原因
   * @param cause 底层错误（日志排查用）
   */
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AiRequestError'
    this.cause = cause
  }
}

/**
 * 把 HTTP 状态码翻译成用户可读的原因。
 *
 * @param status HTTP 状态码
 * @param detail 服务商返回的错误详情（可能有）
 */
function statusMessage(status: number, detail: string): string {
  if (status === 401 || status === 403) {
    return 'Key 无效或没有该模型权限，请检查后重试'
  }
  if (status === 402) {
    return '账户余额不足，请到服务商控制台充值'
  }
  if (status === 404) {
    return '接口地址或模型名不存在：请确认地址以 /v1 结尾、模型名与服务商一致'
  }
  if (status === 429) {
    return '请求过于频繁或额度已用完，请稍后再试'
  }
  if (status >= 500) {
    return `服务商服务异常（${status}），请稍后再试${detail ? `：${detail}` : ''}`
  }
  return `请求失败（${status}）${detail ? `：${detail}` : ''}`
}

/**
 * 组装请求头（鉴权 + Content-Type + 厂商附加头）。
 *
 * @param config 请求配置
 */
function buildHeaders(config: AiRequestConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    ...config.extraHeaders,
  }
}

/**
 * 通用请求执行：超时与外部中断控制、网络层错误翻译。
 *
 * @param config 请求配置
 * @param url 完整请求地址
 * @param body 请求体（JSON 序列化前的对象）
 * @param signal 外部中断信号
 */
async function executeRequest(
  config: AiRequestConfig,
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    // fetch 的网络层失败统一翻译：CORS 拦截 / 断网 / 超时共用 TypeError
    if (controller.signal.aborted) {
      throw new AiRequestError('请求超时或已取消，请重试', error)
    }
    throw new AiRequestError(
      '网络请求失败：可能是该服务商不允许浏览器直接调用（CORS），可改用「自定义」填写兼容接口或中转站地址',
      error,
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * 调用 OpenAI 兼容 chat/completions，返回模型输出文本。
 *
 * 外层为诊断日志包装（耗时 / 结果 / 失败原因，不含提示词内容），
 * 实际请求在 chatCompleteInternal。
 *
 * @param config 请求配置
 * @param options 对话参数
 * @returns 模型输出文本（已 trim）
 * @throws AiRequestError 用户可读的失败原因
 */
export async function chatComplete(
  config: AiRequestConfig,
  options: ChatCompleteOptions,
): Promise<string> {
  const startedAt = Date.now()
  try {
    const text = await chatCompleteInternal(config, options)
    logAiDebug({
      ts: startedAt,
      feature: options.featureTag ?? 'unknown',
      model: config.model,
      host: hostOf(config.baseUrl),
      status: 'ok',
      durationMs: Date.now() - startedAt,
      outputChars: text.length,
    })
    return text
  } catch (error) {
    logAiDebug({
      ts: startedAt,
      feature: options.featureTag ?? 'unknown',
      model: config.model,
      host: hostOf(config.baseUrl),
      status: 'error',
      durationMs: Date.now() - startedAt,
      detail: error instanceof AiRequestError ? error.message : String(error),
    })
    throw error
  }
}

async function chatCompleteInternal(
  config: AiRequestConfig,
  options: ChatCompleteOptions,
): Promise<string> {
  const response = await executeRequest(
    config,
    `${config.baseUrl}/chat/completions`,
    {
      model: config.model,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: false,
    },
    options.signal,
  )

  let payload: ChatCompletionResponse
  if (!response.ok) {
    let detail = ''
    try {
      payload = (await response.json()) as ChatCompletionResponse
      detail = payload.error?.message ?? ''
    } catch {
      // 非 JSON 错误体：保留状态码提示即可
    }
    throw new AiRequestError(statusMessage(response.status, detail))
  }

  payload = (await response.json()) as ChatCompletionResponse
  // OpenRouter 等厂商存在「HTTP 200 + 错误体」的情况，透出真实原因
  if (payload.error !== undefined) {
    throw new AiRequestError(`服务商返回错误：${payload.error.message ?? '未知原因'}`)
  }

  const content = payload.choices?.[0]?.message?.content?.trim() ?? ''
  if (content.length === 0) {
    if (options.emptyContentOk === true) {
      return ''
    }
    const reasoning =
      payload.choices?.[0]?.message?.reasoning ?? payload.choices?.[0]?.message?.reasoning_content
    if (reasoning !== null && reasoning !== undefined && reasoning.trim().length > 0) {
      throw new AiRequestError(
        '该模型把输出额度花在了思考过程上，正文为空：建议换非思考模型重试（或重试一次）',
      )
    }
    throw new AiRequestError('模型返回了空内容，请重试或换一个模型')
  }
  return content
}

/**
 * 连接测试：发一条极小请求验证 Key 与接口可用。
 * 以 HTTP 200 为准（不要求正文非空，思考型模型也能通过）。
 *
 * @param config 请求配置
 * @returns 往返延迟（毫秒）
 * @throws AiRequestError 用户可读的失败原因
 */
export async function testAiConnection(config: AiRequestConfig): Promise<number> {
  const startedAt = Date.now()
  await chatComplete(config, {
    system: '你是连通性测试端点，收到任何消息都只回复：正常',
    user: TEST_USER_MESSAGE,
    maxTokens: TEST_MAX_TOKENS,
    temperature: 0,
    emptyContentOk: true,
  })
  return Date.now() - startedAt
}

/**
 * 获取模型列表（OpenAI 兼容 GET /models），供设置页「获取模型列表」填充。
 *
 * @param config 请求配置（baseUrl + apiKey；extraHeaders 一并携带）
 * @returns 模型 id 列表（升序排序）
 * @throws AiRequestError 用户可读的失败原因
 */
export async function fetchAiModelList(config: AiRequestConfig): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetch(`${config.baseUrl}/models`, {
        method: 'GET',
        headers: buildHeaders(config),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AiRequestError('请求超时或已取消，请重试', error)
      }
      throw new AiRequestError(
        '网络请求失败：可能是该服务商不允许浏览器直接调用（CORS），可改手填模型名',
        error,
      )
    }
    if (!response.ok) {
      let detail = ''
      try {
        const payload = (await response.json()) as ModelsResponse
        detail = payload.error?.message ?? ''
      } catch {
        // 非 JSON 错误体：保留状态码提示即可
      }
      throw new AiRequestError(statusMessage(response.status, detail))
    }
    const payload = (await response.json()) as ModelsResponse
    const ids = (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) {
      throw new AiRequestError('服务商未返回模型列表，请手填模型名')
    }
    return ids.sort((a, b) => a.localeCompare(b))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 流式对话补全（SSE，agent 式生成专用，AI 接入 v3）。
 *
 * 与 chatComplete 的区别：
 * - `stream: true`，思考（reasoning）与正文（content）delta 逐段经回调吐出，
 *   供 UI 实时展示思考过程（v3 交互核心）
 * - **无总超时**：思考型模型输出 30 秒以上是常态，终止只由外部 signal 驱动；
 * - 外部中断（用户点「终止」）**不抛错**，返回已收到的部分内容——
 *   已产生部分保留进编辑框、按实际用量计费（v3 原型定稿行为）。
 *
 * @param config 请求配置（extraHeaders 照常合并）
 * @param options 对话参数（timeoutMs 字段被忽略）
 * @param handlers delta 回调（可选）
 * @returns 全量 content 与 reasoning（用户中断时为已收到部分）
 * @throws AiRequestError 用户可读的失败原因
 */
export async function streamChatComplete(
  config: AiRequestConfig,
  options: ChatCompleteOptions,
  handlers: AgentStreamHandlers = {},
): Promise<AgentStreamResult> {
  const startedAt = Date.now()
  try {
    const result = await streamChatCompleteInternal(config, options, handlers)
    logAiDebug({
      ts: startedAt,
      feature: options.featureTag ?? 'unknown',
      model: config.model,
      host: hostOf(config.baseUrl),
      status: 'ok',
      durationMs: Date.now() - startedAt,
      outputChars: result.content.length,
    })
    return result
  } catch (error) {
    logAiDebug({
      ts: startedAt,
      feature: options.featureTag ?? 'unknown',
      model: config.model,
      host: hostOf(config.baseUrl),
      status: 'error',
      durationMs: Date.now() - startedAt,
      detail: error instanceof AiRequestError ? error.message : String(error),
    })
    throw error
  }
}

async function streamChatCompleteInternal(
  config: AiRequestConfig,
  options: ChatCompleteOptions,
  handlers: AgentStreamHandlers,
): Promise<AgentStreamResult> {
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onExternalAbort)

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user },
        ],
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: true,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    options.signal?.removeEventListener('abort', onExternalAbort)
    if (controller.signal.aborted) {
      return { content: '', reasoning: '' }
    }
    throw new AiRequestError(
      '网络请求失败：可能是该服务商不允许浏览器直接调用（CORS），可改用「自定义」填写兼容接口或中转站地址',
      error,
    )
  }

  // 无响应体：无法走流式读取，整体按普通 JSON 解析（厂商忽略 stream 参数的兜底）
  if (response.body === null || response.body === undefined) {
    options.signal?.removeEventListener('abort', onExternalAbort)
    if (controller.signal.aborted) {
      return { content: '', reasoning: '' }
    }
    if (!response.ok) {
      let detail = ''
      try {
        const payload = (await response.json()) as ChatCompletionResponse
        detail = payload.error?.message ?? ''
      } catch {
        // 非 JSON 错误体：保留状态码提示即可
      }
      throw new AiRequestError(statusMessage(response.status, detail))
    }
    const payload = (await response.json()) as ChatCompletionResponse
    if (payload.error !== undefined) {
      throw new AiRequestError(`服务商返回错误：${payload.error.message ?? '未知原因'}`)
    }
    const message = payload.choices?.[0]?.message
    const fullContent = message?.content?.trim() ?? ''
    const fullReasoning = message?.reasoning ?? message?.reasoning_content ?? ''
    if (fullReasoning.length > 0) {
      handlers.onReasoning?.(fullReasoning)
    }
    if (fullContent.length > 0) {
      handlers.onContent?.(fullContent)
    }
    return { content: fullContent, reasoning: fullReasoning }
  }

  let content = ''
  let reasoning = ''
  let sawData = false
  let sawDone = false
  let sawNonSse = false
  // 全量原始响应（非 SSE 兜底解析用；SSE 分行只从行缓冲取，避免碎片错位）
  let rawAll = ''
  let lineBuf = ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  /** 处理一条 data: 事件；返回是否收到 [DONE] */
  const handleDataEvent = (data: string): boolean => {
    if (data === '[DONE]') {
      return true
    }
    let payload: StreamChunk
    try {
      payload = JSON.parse(data) as StreamChunk
    } catch {
      return false
    }
    if (payload.error !== undefined) {
      throw new AiRequestError(`服务商返回错误：${payload.error.message ?? '未知原因'}`)
    }
    const delta = payload.choices?.[0]?.delta
    if (delta === undefined) {
      return false
    }
    const reasoningDelta = delta.reasoning ?? delta.reasoning_content
    if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
      reasoning += reasoningDelta
      handlers.onReasoning?.(reasoningDelta)
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content
      handlers.onContent?.(delta.content)
    }
    return false
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const text = decoder.decode(value, { stream: true })
      rawAll += text
      lineBuf += text
      // 按 \n 切完整行（半行留缓冲），逐行处理 SSE 事件
      let newlineIndex = lineBuf.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = lineBuf.slice(0, newlineIndex).trim()
        lineBuf = lineBuf.slice(newlineIndex + 1)
        if (line.length === 0 || line.startsWith(':')) {
          // 空行 / SSE 注释（如 OpenRouter 的 : OPENROUTER PROCESSING）
          newlineIndex = lineBuf.indexOf('\n')
          continue
        }
        if (!line.startsWith('data:')) {
          // 非 SSE 内容：整体标记为普通 JSON 兜底，继续收完再解析
          sawNonSse = true
          newlineIndex = lineBuf.indexOf('\n')
          continue
        }
        sawData = true
        if (handleDataEvent(line.slice(5).trim())) {
          sawDone = true
          break
        }
        newlineIndex = lineBuf.indexOf('\n')
      }
      if (sawDone || sawNonSse || controller.signal.aborted) {
        break
      }
    }

    // 非 SSE 响应体兜底（个别厂商忽略 stream 参数返回普通 JSON）：整体解析并一次性回调
    if (!sawData) {
      let payload: ChatCompletionResponse
      try {
        payload = JSON.parse(rawAll.trim()) as ChatCompletionResponse
      } catch (error) {
        throw new AiRequestError('服务商未返回流式数据，请重试或检查接口地址', error)
      }
      if (payload.error !== undefined) {
        throw new AiRequestError(`服务商返回错误：${payload.error.message ?? '未知原因'}`)
      }
      const message = payload.choices?.[0]?.message
      const fullContent = message?.content?.trim() ?? ''
      const fullReasoning = message?.reasoning ?? message?.reasoning_content ?? ''
      if (fullReasoning.length > 0) {
        reasoning += fullReasoning
        handlers.onReasoning?.(fullReasoning)
      }
      if (fullContent.length > 0) {
        content += fullContent
        handlers.onContent?.(fullContent)
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw new AiRequestError(
        error instanceof AiRequestError ? error.message : '流式读取中断，请重试',
        error,
      )
    }
  } finally {
    reader.releaseLock()
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
  return { content, reasoning }
}

/** 流式 delta 事件体（只声明解析用到的字段） */
interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
    }
  }>
  error?: { message?: string }
}

/** 流式回调集合 */
export interface AgentStreamHandlers {
  /** 思考过程 delta（逐段） */
  onReasoning?(delta: string): void

  /** 正文 delta（逐段） */
  onContent?(delta: string): void
}

/** 流式结果（正常完成或用户中断的已收部分） */
export interface AgentStreamResult {
  content: string
  reasoning: string
}
