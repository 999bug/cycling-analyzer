/**
 * 详情页 AI 解读行测试（AiInsightSection）。
 * 契约：未配置 AI 服务整行不渲染；配置后可生成并写缓存；缓存命中时不再请求。
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
  useAiConfigStore.setState({ providerId: null, apiKey: '', model: '', customBaseUrl: '' })
  vi.restoreAllMocks()
})

describe('AiInsightSection', () => {
  it('未配置 AI 服务时不渲染', () => {
    const { container } = render(<AiInsightSection activity={makeActivity()} distanceUnit="km" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('配置后可生成解读并写入活动缓存', async () => {
    useAiConfigStore.setState({
      providerId: 'deepseek',
      apiKey: 'sk-test-123456',
      model: 'deepseek-chat',
      customBaseUrl: '',
    })
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '本次属于节奏爬坡训练，强度不低。' } }] }),
      }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<AiInsightSection activity={makeActivity()} ftp={235} distanceUnit="km" />)
    fireEvent.click(screen.getByRole('button', { name: '生成解读' }))

    await waitFor(() => expect(screen.getByText('本次属于节奏爬坡训练，强度不低。')).toBeDefined())
    // 按钮切换为重新解读
    expect(screen.getByRole('button', { name: '重新解读' })).toBeDefined()
    // 缓存落盘
    const raw = window.localStorage.getItem('cycling-ai-insight-cache')
    expect(raw).toContain('节奏爬坡')

    vi.unstubAllGlobals()
  })

  it('缓存命中时直接展示，不发请求', () => {
    useAiConfigStore.setState({
      providerId: 'deepseek',
      apiKey: 'sk-test-123456',
      model: 'deepseek-chat',
      customBaseUrl: '',
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
})
