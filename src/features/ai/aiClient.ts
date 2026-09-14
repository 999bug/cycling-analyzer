/**
 * AI 请求客户端（OpenAI 兼容 chat/completions，AI 接入 v1）。
 *
 * 浏览器直连服务商（BYOK 架构，无后端代理）：Key 只存本机浏览器，
 * 请求从用户浏览器直接发往服务商接口。个别服务商可能不开浏览器 CORS，
 * fetch 抛 TypeError 时给出指向「自定义兼容接口/中转站」的提示。
 *
 * 上行数据边界（硬约束）：调用方只能传聚合指标文案（见 aiPrompts），
 * 严禁把 GPS 轨迹点、逐点心率等原始序列塞进 prompt。
 */

/** 单次请求超时（毫秒）：文案生成是小请求，30 秒足够覆盖慢模型 */
const REQUEST_TIMEOUT_MS = 30_000

/** 连接测试的最大输出 token（只需模型回一个词） */
const TEST_MAX_TOKENS = 8

/** 连接测试的用户消息（要求极短回复，控制成本） */
const TEST_USER_MESSAGE = '请只回复两个字：正常'

/** AI 请求配置（来自 resolveAiConfig） */
export interface AiRequestConfig {
  /** OpenAI 兼容接口根地址（如 https://api.deepseek.com/v1） */
  baseUrl: string

  /** API Key */
  apiKey: string

  /** 模型 ID */
  model: string
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
}

/** chat/completions 返回的 message 结构（只取需要的字段） */
interface ChatChoiceMessage {
  content?: string
}

/** chat/completions 响应体（只声明解析用到的字段） */
interface ChatCompletionResponse {
  choices?: Array<{ message?: ChatChoiceMessage }>
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
    return '接口地址或模型名不存在，请检查配置'
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
 * 调用 OpenAI 兼容 chat/completions，返回模型输出文本。
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
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // 外部中断（组件卸载等）联动内部超时控制
  const onExternalAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onExternalAbort)

  try {
    let response: Response
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.user },
          ],
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          stream: false,
        }),
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
    const content = payload.choices?.[0]?.message?.content ?? ''
    if (content.trim().length === 0) {
      throw new AiRequestError('模型返回了空内容，请重试或换一个模型')
    }
    return content.trim()
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * 连接测试：发一条极小请求验证 Key 与接口可用。
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
  })
  return Date.now() - startedAt
}
