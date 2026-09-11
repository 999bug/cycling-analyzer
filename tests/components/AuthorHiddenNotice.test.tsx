/**
 * 「作者数据已隐藏」提示条组件测试。
 *
 * 仅 authorHiddenNoticePending 时显示；「去更多」跳转 /settings#author-data
 * 并清除标记；关闭仅清除标记。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import AuthorHiddenNotice from '@/components/AuthorHiddenNotice'
import { useDataSourceStore } from '@/stores/dataSourceStore'

/** 渲染包装（组件内 useNavigate 需要 Router 上下文） */
function renderNotice(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthorHiddenNotice />
    </MemoryRouter>,
  )
}

describe('AuthorHiddenNotice', () => {
  beforeEach(() => {
    localStorage.clear()
    useDataSourceStore.setState({ authorHiddenNoticePending: false })
  })

  it('标记未置时不渲染', () => {
    const { container } = renderNotice()
    expect(container).toBeEmptyDOMElement()
  })

  it('标记置位时显示提示与「去更多」按钮', () => {
    useDataSourceStore.setState({ authorHiddenNoticePending: true })
    renderNotice()
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('作者的示例数据已默认隐藏')
    expect(screen.getByRole('button', { name: '去更多' })).toBeInTheDocument()
  })

  it('点「去更多」清除标记（导航交给外层 Router）', async () => {
    const user = userEvent.setup()
    useDataSourceStore.setState({ authorHiddenNoticePending: true })
    renderNotice()
    await user.click(screen.getByRole('button', { name: '去更多' }))
    expect(useDataSourceStore.getState().authorHiddenNoticePending).toBe(false)
  })

  it('点关闭仅清除标记', async () => {
    const user = userEvent.setup()
    useDataSourceStore.setState({ authorHiddenNoticePending: true })
    renderNotice()
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(useDataSourceStore.getState().authorHiddenNoticePending).toBe(false)
  })
})
