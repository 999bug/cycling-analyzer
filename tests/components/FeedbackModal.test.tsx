/**
 * 反馈弹窗组件测试：提交成功展示 issue 链接、网络失败回退手动链接、空标题禁用提交。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import FeedbackModal from '@/components/FeedbackModal'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('FeedbackModal 反馈弹窗', () => {
  it('填写标题与描述后提交，调用端点并展示新 Issue 链接', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        issueUrl: 'https://github.com/999bug/cycling-analyzer/issues/142',
        issueNumber: 142,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<FeedbackModal onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '均速显示异常' } })
    fireEvent.change(screen.getByLabelText('详细描述'), { target: { value: '某活动详情页均速偏低' } })
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }))

    // 等待成功态
    expect(await screen.findByText(/已为你创建 GitHub Issue #142/)).toBeDefined()

    // 端点调用参数正确
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/submit')
    const body = JSON.parse(init.body as string)
    expect(body.type).toBe('Bug 报告')
    expect(body.title).toBe('均速显示异常')
    expect(body.description).toBe('某活动详情页均速偏低')
    expect(typeof body.version).toBe('string')
    expect(typeof body.ua).toBe('string')

    // 成功态展示查看链接
    const link = screen.getByRole('link', { name: /查看 Issue #142/ })
    expect(link.getAttribute('href')).toBe('https://github.com/999bug/cycling-analyzer/issues/142')
  })

  it('提交按钮在标题为空时禁用', () => {
    render(<FeedbackModal onClose={() => {}} />)
    const submit = screen.getByRole('button', { name: '提交反馈' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('网络异常时回退到 GitHub 手动新建链接', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'))
    vi.stubGlobal('fetch', fetchMock)

    render(<FeedbackModal onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '反馈标题' } })
    fireEvent.change(screen.getByLabelText('详细描述'), { target: { value: '反馈内容' } })
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }))

    expect(await screen.findByText(/网络异常/)).toBeDefined()
    const manual = screen.getByRole('link', { name: /在 GitHub 新建 Issue/ }) as HTMLAnchorElement
    const href = manual.getAttribute('href') ?? ''
    expect(href).toContain('github.com/999bug/cycling-analyzer/issues/new')
    // searchParams 把空格编码为 +，解码后核对预填标题
    expect(decodeURIComponent(href.replace(/\+/g, ' '))).toContain('[反馈] 反馈标题')
  })
})
