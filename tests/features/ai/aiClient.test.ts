/**
 * AI 请求客户端测试（aiClient）。
 * mock 全局 fetch：成功解析 / 各类错误翻译 / 网络层失败（CORS 提示）/
 * 连接测试返回延迟。用户可读的错误信息是本模块的核心契约。
 * v2：厂商附加请求头合并、GET /models 拉取、200+错误体透出、
 * 思考型模型空正文（连接测试放行 / 文案报可读原因）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiRequestError, chatComplete, fetchAiModelList, streamChatComplete, testAiConnection } from '@/features/ai/aiClient'

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
      chatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toThrow('请求过于频繁')

    vi.mocked(fetch).mockImplementation(async () => jsonResponse({}, 503))
    await expect(
      chatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toThrow('服务商服务异常（503）')
  })

  it('限流与 5xx 重试两次后仍失败（共三次请求）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 429))
    vi.mocked(fetch).mockImplementation(fetchMock)
    await expect(
      chatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toThrow('请求过于频繁')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('业务性失败（401）不重试，只发一次请求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'bad key' } }, 401))
    vi.mocked(fetch).mockImplementation(fetchMock)
    await expect(
      chatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toThrow('Key 无效')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetch 抛 TypeError（CORS/断网）→ 指向自定义接口的提示', async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      chatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toThrow('浏览器直接调用')
  })

  it('空输出 → 明确报错而不是返回空串', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ choices: [{ message: { content: '' } }] }))
    await expect(
      chatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toBeInstanceOf(AiRequestError)
  })

  it('HTTP 200 + 错误体（OpenRouter 特性）→ 透出真实原因', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ error: { message: 'User not found.' } }))
    await expect(
      chatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toThrow('服务商返回错误：User not found.')
  })

  it('思考型模型空正文（带 reasoning）→ 报可读原因；连接测试则放行', async () => {
    const reasoningOnly = jsonResponse({
      choices: [{ message: { content: '', reasoning: '让我想一想……' }, finish_reason: 'length' }],
    })
    vi.mocked(fetch).mockImplementation(async () => reasoningOnly)
    await expect(
      chatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toThrow('把输出额度花在了思考过程上')

    // 连接测试：HTTP 200 即算连通（不要求正文非空）
    await expect(testAiConnection(CONFIG)).resolves.toBeGreaterThanOrEqual(0)
  })

  it('厂商附加请求头（extraHeaders）合并进请求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.mocked(fetch).mockImplementation(fetchMock)

    await chatComplete(
      {
        ...CONFIG,
        extraHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
      },
      { system: '', user: '', maxTokens: 1, temperature: 0 },
    )

    const [, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]
    expect((init.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe(
      'true',
    )
  })
})

describe('testAiConnection', () => {
  it('返回毫秒级延迟（非负数）', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ choices: [{ message: { content: '正常' } }] }))
    const latency = await testAiConnection(CONFIG)
    expect(latency).toBeGreaterThanOrEqual(0)
  })
})

describe('fetchAiModelList', () => {
  it('GET /models 解析 data[].id 并升序排序', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: '' }] }))
    vi.mocked(fetch).mockImplementation(fetchMock)

    const models = await fetchAiModelList(CONFIG)
    expect(models).toEqual(['a-model', 'b-model'])
    const [url] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]
    expect(url).toBe('https://api.example.com/v1/models')
  })

  it('失败（401 / 空列表）→ 用户可读原因', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ error: { message: 'bad' } }, 401))
    await expect(fetchAiModelList(CONFIG)).rejects.toThrow('Key 无效')

    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ data: [] }))
    await expect(fetchAiModelList(CONFIG)).rejects.toThrow('服务商未返回模型列表')
  })
})

/** 用手动 getReader 实现的流式响应桩（jsdom 无 ReadableStream 依赖） */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined },
        releaseLock: () => {},
      }),
    },
  } as unknown as Response
}

describe('streamChatComplete（agent 式流式）', () => {
  it('解析 reasoning / content delta 并逐段回调', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning":"想一想"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"：先看数据"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"晨骑"}}]}\n\ndata: {"choices":[{"delta":{"content":"42.7km"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const seen: { r?: string; c?: string } = {}
    const result = await streamChatComplete(CONFIG, { system: '', user: '', maxTokens: 100, temperature: 0 }, {
      onReasoning: (d) => {
        seen.r = (seen.r ?? '') + d
      },
      onContent: (d) => {
        seen.c = (seen.c ?? '') + d
      },
    })
    expect(seen.r).toBe('想一想：先看数据')
    expect(seen.c).toBe('晨骑42.7km')
    expect(result.content).toBe('晨骑42.7km')
    expect(result.reasoning).toBe('想一想：先看数据')
  })

  it('流中错误事件 → 抛出真实原因', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      sseResponse(['data: {"error":{"message":"User not found."}}\n\n']),
    )
    await expect(
      streamChatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toThrow('服务商返回错误：User not found.')
  })

  it('请求体带 stream: true 且携带 extraHeaders', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
    vi.mocked(fetch).mockImplementation(fetchMock)
    await streamChatComplete(
      { ...CONFIG, extraHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' } },
      { system: '', user: '', maxTokens: 1, temperature: 0 },
    )
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(JSON.parse(String(init.body)).stream).toBe(true)
    expect((init.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe('true')
  })

  it('厂商忽略 stream 参数返回普通 JSON（无响应体）→ 兜底一次性解析', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ choices: [{ message: { content: '正文', reasoning: '思考' } }] }),
    )
    const result = await streamChatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 })
    expect(result.content).toBe('正文')
    expect(result.reasoning).toBe('思考')
  })

  it('外部中断：返回已收到的部分内容而不抛错', async () => {
    const encoder = new TextEncoder()
    const chunks = ['data: {"choices":[{"delta":{"content":"部分"}}]}\n\n']
    let index = 0
    const abort = new AbortController()
    let released = false
    const stream = {
      getReader: () => ({
        // 第二次 read 挂起直到外部中断，模拟真实长连接被用户终止
        read: () =>
          new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
            if (index < chunks.length) {
              resolve({ done: false, value: encoder.encode(chunks[index++]) })
              return
            }
            abort.signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), {
              once: true,
            })
          }),
        releaseLock: () => {
          released = true
        },
      }),
    }
    vi.mocked(fetch).mockImplementation(
      async () => ({ ok: true, status: 200, body: stream }) as unknown as Response,
    )

    const pending = streamChatComplete(CONFIG, {
      system: '',
      user: '',
      maxTokens: 1,
      temperature: 0,
      signal: abort.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    abort.abort()
    const result = await pending
    expect(result.content).toBe('部分')
    expect(released).toBe(true)
  })
})

describe('streamChatComplete 非 SSE 响应体兜底（2.80.1 回归）', () => {
  /** 用文本块构造的流式响应桩 */
  function textResponse(text: string): Response {
    const encoder = new TextEncoder()
    let sent = false
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) {
              return { done: true, value: undefined }
            }
            sent = true
            return { done: false, value: encoder.encode(text) }
          },
          releaseLock: () => {},
        }),
      },
    } as unknown as Response
  }

  it('单行普通 JSON（旧版静默返回空）→ 兜底解析出正文', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      textResponse('{"choices":[{"message":{"content":"正文内容"}}]}'),
    )
    const result = await streamChatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 })
    expect(result.content).toBe('正文内容')
  })

  it('多行格式化 JSON（旧版误报「流式读取中断」）→ 兜底解析出正文', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      textResponse('{\n  "choices": [\n    { "message": { "content": "格式化正文", "reasoning": "思考" } }\n  ]\n}'),
    )
    const result = await streamChatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 })
    expect(result.content).toBe('格式化正文')
    expect(result.reasoning).toBe('思考')
  })

  it('非 JSON 垃圾响应 → 明确报错而不是笼统的中断提示', async () => {
    vi.mocked(fetch).mockImplementation(async () => textResponse('<html>gateway error</html>'))
    await expect(
      streamChatComplete(CONFIG, { system: '', user: '', maxTokens: 1, temperature: 0 }),
    ).rejects.toThrow('服务商未返回流式数据')
  })
})

describe('streamChatComplete 空闲超时（P0 止血）', () => {
  /** 建连成功但一个字节都不吐的响应桩（模拟服务端假死，旧实现会永久挂起） */
  function silentStream(): Response {
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => new Promise<{ done: boolean; value?: Uint8Array }>(() => {}),
          releaseLock: () => {},
        }),
      },
    } as unknown as Response
  }

  it('首字节超时：服务端建连后不吐字节 → 明确报错而不是永久挂起', async () => {
    const fetchMock = vi.fn(async () => silentStream())
    vi.mocked(fetch).mockImplementation(fetchMock)
    await expect(
      streamChatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        // 关掉重试：本例只验证超时会被触发，不验证重试次数
        retryDelaysMs: [],
        streamTimeoutsMs: { first: 10 },
      }),
    ).rejects.toThrow('服务商迟迟没有响应')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('首字节超时后可重试：退避耗尽后共发起三次请求', async () => {
    const fetchMock = vi.fn(async () => silentStream())
    vi.mocked(fetch).mockImplementation(fetchMock)
    await expect(
      streamChatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        retryDelaysMs: [0, 0],
        streamTimeoutsMs: { first: 10 },
      }),
    ).rejects.toThrow('服务商迟迟没有响应')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('静默超时但已产出内容 → 保留已收到部分（与用户主动中断同语义）', async () => {
    const encoder = new TextEncoder()
    const chunks = ['data: {"choices":[{"delta":{"content":"部分"}}]}\n\n']
    let index = 0
    vi.mocked(fetch).mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              // 吐出一个 delta 后永久挂起，模拟输出中途连接假死
              read: () =>
                index < chunks.length
                  ? Promise.resolve({ done: false, value: encoder.encode(chunks[index++]) })
                  : new Promise<{ done: boolean; value?: Uint8Array }>(() => {}),
              releaseLock: () => {},
            }),
          },
        }) as unknown as Response,
    )
    await expect(
      streamChatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        retryDelaysMs: [],
        streamTimeoutsMs: { first: 200, idle: 10 },
      }),
    ).resolves.toMatchObject({ content: '部分' })
  })

  it('HTTP 错误响应（429 带响应体）→ 按状态码报错，不再被当成垃圾流式数据', async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      const encoder = new TextEncoder()
      let sent = false
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'slow down' } }),
        body: {
          getReader: () => ({
            read: () =>
              sent
                ? Promise.resolve({ done: true, value: undefined })
                : ((sent = true),
                  Promise.resolve({ done: false, value: encoder.encode('{"error":{}}') })),
            releaseLock: () => {},
          }),
        },
      } as unknown as Response
    })
    await expect(
      streamChatComplete(CONFIG, {
        system: '',
        user: '',
        maxTokens: 1,
        temperature: 0,
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toThrow('请求过于频繁')
  })
})
