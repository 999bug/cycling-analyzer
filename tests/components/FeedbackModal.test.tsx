/**
 * 反馈弹窗组件测试（零后端方案）：提交即打开 GitHub 预填 issue 页、空标题禁用提交、类型带入 label。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import FeedbackModal from '@/components/FeedbackModal'

beforeEach(() => {
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FeedbackModal 反馈弹窗（零后端）', () => {
  it('填写标题与描述后提交，打开 GitHub 预填 issue 页并展示兜底链接', () => {
    render(<FeedbackModal onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '均速显示异常' } })
    fireEvent.change(screen.getByLabelText('详细描述'), { target: { value: '某活动详情页均速偏低' } })
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }))

    // 打开预填链接
    expect(window.open).toHaveBeenCalledTimes(1)
    const [url, target] = (window.open as unknown as Mock).mock.calls[0]
    expect(target).toBe('_blank')
    const decoded = decodeURIComponent(String(url).replace(/\+/g, ' '))
    expect(decoded).toContain('github.com/999bug/cycling-analyzer/issues/new')
    expect(decoded).toContain('[反馈] 均速显示异常')
    expect(decoded).toContain('类型：Bug 报告')
    expect(decoded).toContain('版本：')
    expect(decoded).toContain('labels=bug')

    // done 态提示 + 兜底链接
    expect(screen.getByText(/已打开 GitHub 提交页/)).toBeDefined()
    const link = screen.getByRole('link', { name: /前往 GitHub 提交/ })
    expect(link.getAttribute('href')).toContain('issues/new')
  })

  it('提交按钮在标题为空时禁用', () => {
    render(<FeedbackModal onClose={() => {}} />)
    const submit = screen.getByRole('button', { name: '提交反馈' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('选「功能建议」时预填对应 label', () => {
    render(<FeedbackModal onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: '功能建议' } })
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '加个深色模式' } })
    fireEvent.change(screen.getByLabelText('详细描述'), { target: { value: '想要更护眼' } })
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }))

    const [url] = (window.open as unknown as Mock).mock.calls[0]
    expect(decodeURIComponent(String(url))).toContain('labels=enhancement')
  })
})
