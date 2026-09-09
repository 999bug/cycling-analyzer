/**
 * 反馈弹窗组件测试（纯飞书表单方案）。
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

describe('FeedbackModal 反馈弹窗', () => {
  it('展示飞书表单二维码与打开按钮', () => {
    render(<FeedbackModal onClose={() => {}} />)

    expect(screen.getByRole('img', { name: /飞书反馈表单二维码/ })).toBeDefined()
    expect(screen.getByRole('button', { name: '打开飞书表单' })).toBeDefined()
    expect(screen.getByText(/手机扫码填写/)).toBeDefined()
  })

  it('点击打开按钮在新标签页打开飞书表单链接', () => {
    render(<FeedbackModal onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '打开飞书表单' }))

    expect(window.open).toHaveBeenCalledTimes(1)
    const [url, target] = (window.open as unknown as Mock).mock.calls[0]
    expect(String(url)).toBe('https://my.feishu.cn/share/base/form/shrcnbhhExuS6XWrvMbWcsHDlEh')
    expect(target).toBe('_blank')
  })

  it('点击遮罩或关闭按钮触发 onClose', () => {
    const onClose = vi.fn()
    const { container } = render(<FeedbackModal onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('.feedback-overlay') as Element)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
