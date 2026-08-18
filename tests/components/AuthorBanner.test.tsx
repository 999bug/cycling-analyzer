/**
 * 作者模式横幅组件测试。
 *
 * 仅作者模式显示（说明正在查看作者发布的只读数据）；
 * 关闭后 localStorage 记忆，不再显示；本地模式不渲染。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import AuthorBanner from '@/components/AuthorBanner'
import { useDataSourceStore } from '@/stores/dataSourceStore'

/** 关闭记忆的 localStorage key */
const DISMISS_KEY = 'author-banner-dismissed'

describe('AuthorBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    useDataSourceStore.setState({ source: 'author', authorAvailable: true, authorName: 'Saul' })
  })

  it('作者模式显示横幅且含作者名', () => {
    render(<AuthorBanner />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Saul')
    expect(banner).toHaveTextContent('只读')
  })

  it('本地模式不渲染', () => {
    useDataSourceStore.setState({ source: 'local' })
    const { container } = render(<AuthorBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('快照不可用时（有效源回退本地）不渲染', () => {
    useDataSourceStore.setState({ authorAvailable: false })
    const { container } = render(<AuthorBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('点关闭后消失并写入 localStorage', async () => {
    const user = userEvent.setup()
    render(<AuthorBanner />)
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1')
  })

  it('已记忆关闭时不再显示', () => {
    localStorage.setItem(DISMISS_KEY, '1')
    const { container } = render(<AuthorBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
