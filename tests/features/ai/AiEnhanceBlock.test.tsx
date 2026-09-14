/**
 * AI 增强区块测试（AiEnhanceBlock，v4 内容面）。
 * 契约：默认渲染本地内容（未配置 AI 时无任何按钮）；点「AI 解读」流式生成
 * 并替换；本地 / AI 可来回切；「重新生成」重新请求；结果按 cacheKey 缓存；
 * 一键解读串行补齐未生成的区块。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AiEnhanceBlock, { AiEnhanceAllButton } from '@/features/ai/AiEnhanceBlock'
import { hasEnhanceEntries } from '@/features/ai/enhanceRegistry'
import { useAiConfigStore } from '@/features/ai/aiConfigStore'

/** 构造 SSE 流式响应桩 */
function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder()
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < events.length
            ? { done: false, value: encoder.encode(events[index++]) }
            : { done: true, value: undefined },
        releaseLock: () => {},
      }),
    },
  } as unknown as Response
}

function sseOk(text: string): Response {
  return sseResponse([
    `data: {"choices":[{"delta":{"reasoning":"先看数据"}}]}\n\n`,
    `data: {"choices":[{"delta":{"content":"${text}"}}]}\n\n`,
    'data: [DONE]\n\n',
  ])
}

const okParams = () => ({
  config: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test-123456', model: 'deepseek-chat' },
  system: 'sys',
  user: 'usr',
  maxTokens: 10000,
  temperature: 0.7,
})

function configure() {
  useAiConfigStore.setState({
    profiles: [
      {
        id: 'p1',
        name: 'DeepSeek',
        vendorId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-123456',
        model: 'deepseek-chat',
      },
    ],
    activeProfileId: 'p1',
  })
}

/** 两个区块的固定挂载（key 由 props 传入） */
function renderBlocks() {
  return render(
    <div>
      <AiEnhanceAllButton />
      <AiEnhanceBlock cacheKey="insights:act-1" buildParams={okParams}>
        <div>本地洞察内容</div>
      </AiEnhanceBlock>
      <AiEnhanceBlock cacheKey="score:act-1" buildParams={okParams}>
        <div>本地评分内容</div>
      </AiEnhanceBlock>
    </div>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  useAiConfigStore.setState({ profiles: [], activeProfileId: null })
  vi.restoreAllMocks()
})

describe('AiEnhanceBlock', () => {
  it('未配置 AI 服务：只渲染本地内容，无按钮', () => {
    render(
      <AiEnhanceBlock cacheKey="insights:act-1" buildParams={okParams}>
        <div>本地洞察内容</div>
      </AiEnhanceBlock>,
    )
    expect(screen.getByText('本地洞察内容')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'AI 解读' })).toBeNull()
  })

  it('点「AI 解读」→ 流式生成替换本地内容并写缓存', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => sseOk('AI 版洞察内容')))
    render(
      <AiEnhanceBlock cacheKey="insights:act-1" buildParams={okParams}>
        <div>本地洞察内容</div>
      </AiEnhanceBlock>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'AI 解读' }))

    await waitFor(() => expect(screen.getByText('AI 版洞察内容')).toBeDefined())
    // 生成后可来回切
    fireEvent.click(screen.getByRole('button', { name: '本地结论' }))
    expect(screen.getByText('本地洞察内容')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'AI 结论' }))
    expect(screen.getByText('AI 版洞察内容')).toBeDefined()
    // 缓存落盘
    const raw = window.localStorage.getItem('cycling-ai-insight-cache')
    expect(raw).toContain('AI 版洞察内容')

    vi.unstubAllGlobals()
  })

  it('重新生成会再次请求', async () => {
    configure()
    const fetchMock = vi.fn(async () => sseOk('AI 版洞察内容'))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AiEnhanceBlock cacheKey="insights:act-1" buildParams={okParams}>
        <div>本地洞察内容</div>
      </AiEnhanceBlock>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'AI 解读' }))
    await waitFor(() => expect(screen.getByText('AI 版洞察内容')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2))

    vi.unstubAllGlobals()
  })

  it('有缓存时重进页面：默认本地、可直接切 AI 版', () => {
    configure()
    window.localStorage.setItem(
      'cycling-ai-insight-cache',
      JSON.stringify({ 'insights:act-1': { text: '缓存的 AI 版', at: '2026-09-14T00:00:00.000Z' } }),
    )
    render(
      <AiEnhanceBlock cacheKey="insights:act-1" buildParams={okParams}>
        <div>本地洞察内容</div>
      </AiEnhanceBlock>,
    )
    expect(screen.getByText('本地洞察内容')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'AI 结论' }))
    expect(screen.getByText('缓存的 AI 版')).toBeDefined()
  })
})

describe('AiEnhanceAllButton（一键解读）', () => {
  it('串行补齐未生成的区块', async () => {
    configure()
    const fetchMock = vi.fn(async () => sseOk('AI 版内容'))
    vi.stubGlobal('fetch', fetchMock)

    renderBlocks()
    // 区块挂载后一键按钮出现
    await waitFor(() => expect(screen.getByRole('button', { name: '一键解读全部' })).toBeDefined())
    expect(hasEnhanceEntries()).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '一键解读全部' }))
    await waitFor(() =>
      expect(screen.getAllByText('AI 版内容')).toHaveLength(2),
    )
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)

    vi.unstubAllGlobals()
  })

  it('未配置 AI 服务时不渲染', () => {
    renderBlocks()
    expect(screen.queryByRole('button', { name: '一键解读全部' })).toBeNull()
  })
})
