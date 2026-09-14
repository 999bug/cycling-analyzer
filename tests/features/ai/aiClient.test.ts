/**
 * AI 请求客户端测试（aiClient）。
 * mock 全局 fetch：成功解析 / 各类错误翻译 / 网络层失败（CORS 提示）/
 * 连接测试返回延迟。用户可读的错误信息是本模块的核心契约。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiRequestError, chatComplete, testAiConnection } from '@/features/ai/aiClient'

const CONFIG = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
}

/** 造一个 OpenAI 兼容响应的 Response 桩 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chatComplete', () => {
  it('请求打在 {baseUrl}/chat/completions，携带 Bearer Key 并解析输出', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '  好文案  ' } }] }),
    )
    vi.mocked(fetch).mockImplementation(fetchMock)

    const text = await chatComplete(CONFIG, {
      system: 'sys',
      user: 'usr',
      maxTokens: 100,
      temperature: 0.5,
    })

    expect(text).toBe('好文案')
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('test-model')
    expect(body.messages).toHaveLength(2)
  })

  it('401 → Key 无效提示', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ error: { message: 'bad key' } }, 401))
    await expect(
      chatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toThrow('Key 无效或没有该模型权限')
  })

  it('429 → 限流提示；5xx → 服务商异常提示', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({}, 429))
    await expect(
      chatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toThrow('请求过于频繁')

    vi.mocked(fetch).mockImplementation(async () => jsonResponse({}, 503))
    await expect(
      chatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toThrow('服务商服务异常（503）')
  })

  it('fetch 抛 TypeError（CORS/断网）→ 指向自定义接口的提示', async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      chatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toThrow('浏览器直接调用')
  })

  it('空输出 → 明确报错而不是返回空串', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ choices: [{ message: { content: '' } }] }))
    await expect(
      chatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toBeInstanceOf(AiRequestError)
  })
})

describe('testAiConnection', () => {
  it('返回毫秒级延迟（非负数）', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ choices: [{ message: { content: '正常' } }] }))
    const latency = await testAiConnection(CONFIG)
    expect(latency).toBeGreaterThanOrEqual(0)
  })
})
