/**
 * 详情页骑行解读行测试（AiInsightSection）。
 * 契约：未配置 AI 服务只渲染本地内容（总结条）；配置后可生成并写缓存；
 * 缓存命中时不再请求；标题「骑行解读」本地 / AI 两态共存。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AiInsightSection from '@/features/ai/AiInsightSection'
import { useAiConfigStore } from '@/features/ai/aiConfigStore'
import type { Activity } from '@/types/activity'

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    fileId: 'file-1',
    fileName: 'sample.fit',
    fingerprint: 'fp-1',
    activityType: 'cycling',
    startTime: '2026-09-13T06:32:00',
    endTime: '2026-09-13T08:02:00',
    duration: 5421,
    elapsedTime: 5700,
    distance: 42_700,
    elevationGain: 683,
    avgSpeed: 7.89,
    name: '晨骑 · 环滴水湖',
    ...overrides,
  }
}

beforeEach(() => {
  window.localStorage.clear()
  useAiConfigStore.setState({ profiles: [], activeProfileId: null })
  vi.restoreAllMocks()
})

describe('AiInsightSection', () => {
  it('未配置 AI 服务时只渲染本地内容（总结条），无任何控件', () => {
    const { container } = render(
      <AiInsightSection
        activity={makeActivity()}
        distanceUnit="km"
        localNode={<p>本地总结条</p>}
      />,
    )
    expect(screen.getByText('本地总结条')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('.ai-miniseg')).toBeNull()
  })

  it('配置后可生成解读并写入活动缓存', async () => {
    useAiConfigStore.setState({
      profiles: [{
        id: 'p1',
        name: 'DeepSeek',
        vendorId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-123456',
        model: 'deepseek-chat',
      }],
      activeProfileId: 'p1',
    })
    const fetchMock = vi.fn(async () => {
      const encoder = new TextEncoder()
      let index = 0
      const chunks = [
        'data: {"choices":[{"delta":{"reasoning":"先看数据……"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"本次属于节奏爬坡训练，强度不低。"}}]}\n\n',
        'data: [DONE]\n\n',
      ]
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
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AiInsightSection activity={makeActivity()} ftp={235} distanceUnit="km" />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 解读' }))

    await waitFor(() => expect(screen.getByText('本次属于节奏爬坡训练，强度不低。')).toBeDefined())
    // 流式结束后控件换为 [本地|AI] + ⟳（流式过程中额外有 ■ 终止）
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重新生成 AI 解读' })).toBeDefined(),
    )
    // 缓存落盘
    const raw = window.localStorage.getItem('cycling-ai-insight-cache')
    expect(raw).toContain('节奏爬坡')

    vi.unstubAllGlobals()
  })

  it('缓存命中时直接展示，不发请求', () => {
    useAiConfigStore.setState({
      profiles: [{
        id: 'p1',
        name: 'DeepSeek',
        vendorId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-123456',
        model: 'deepseek-chat',
      }],
      activeProfileId: 'p1',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.setItem(
      'cycling-ai-insight-cache',
      JSON.stringify({ 'act-1': { text: '缓存里的解读', at: '2026-09-14T00:00:00.000Z' } }),
    )

    render(<AiInsightSection activity={makeActivity()} distanceUnit="km" />)
    expect(screen.getByText('缓存里的解读')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('本地态默认展示确定性总结，切「AI」回到解读正文', () => {
    useAiConfigStore.setState({
      profiles: [{
        id: 'p1',
        name: 'DeepSeek',
        vendorId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-123456',
        model: 'deepseek-chat',
      }],
      activeProfileId: 'p1',
    })
    window.localStorage.setItem(
      'cycling-ai-insight-cache',
      JSON.stringify({ 'act-1': { text: '缓存里的解读', at: '2026-09-14T00:00:00.000Z' } }),
    )

    render(
      <AiInsightSection
        activity={makeActivity()}
        distanceUnit="km"
        localNode={<p>长距离，全程 207 公里，均速 21.2 公里每小时</p>}
      />,
    )
    // 有缓存时默认进 AI 态；切本地可见确定性总结，再切 AI 回到解读
    expect(screen.getByText('缓存里的解读')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '本地' }))
    expect(screen.getByText('长距离，全程 207 公里，均速 21.2 公里每小时')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(screen.getByText('缓存里的解读')).toBeDefined()
  })

  it('标题「骑行解读」在本地与 AI 两种模式下都在', () => {
    useAiConfigStore.setState({
      profiles: [{
        id: 'p1',
        name: 'DeepSeek',
        vendorId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-123456',
        model: 'deepseek-chat',
      }],
      activeProfileId: 'p1',
    })
    window.localStorage.setItem(
      'cycling-ai-insight-cache',
      JSON.stringify({ 'act-1': { text: '缓存里的解读', at: '2026-09-14T00:00:00.000Z' } }),
    )
    render(
      <AiInsightSection
        activity={makeActivity()}
        distanceUnit="km"
        localNode={<p>本地总结</p>}
      />,
    )
    expect(screen.getByRole('heading', { name: '骑行解读' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '本地' }))
    expect(screen.getByRole('heading', { name: '骑行解读' })).toBeDefined()
  })
})
