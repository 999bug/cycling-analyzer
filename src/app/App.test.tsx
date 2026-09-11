import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '@/app/App'
import AppLayout from '@/layouts/AppLayout'

/**
 * App 根组件冒烟测试。
 * 用 MemoryRouter 替代 BrowserRouter，无需浏览器环境。
 */
describe('App 根组件', () => {
  it('在根路径渲染仪表盘页面，并显示侧边导航', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    // 仪表盘页面标题渲染
    expect(screen.getByRole('heading', { name: '仪表盘' })).toBeInTheDocument()
    // 侧边导航包含"骑行记录"
    expect(screen.getByRole('link', { name: '骑行记录' })).toBeInTheDocument()
  })
})

/**
 * 移动端导航测试（2026-09-11 汉堡按钮移除后）：
 * 移动端抽屉改由底部 TabBar「更多」页签打开。jsdom 不做 CSS 布局，TabBar 与
 * 抽屉 DOM 始终存在，直接通过 aria-expanded / 遮罩 / class 断言开合逻辑。
 */
describe('AppLayout 移动端导航', () => {
  const user = userEvent.setup()

  /** 查询 TabBar「更多」按钮（打开抽屉） */
  const queryMoreButton = () => screen.getByRole('button', { name: '更多' })

  it('「更多」默认收起（aria-expanded=false），点击展开抽屉并出现遮罩', async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    const moreButton = queryMoreButton()
    expect(moreButton).toHaveAttribute('aria-expanded', 'false')
    expect(moreButton).toHaveAttribute('aria-controls', 'app-nav')

    await user.click(moreButton)

    expect(moreButton).toHaveAttribute('aria-expanded', 'true')
    // 抽屉获得 open class（DOM 始终渲染，靠 class 表达开合）
    expect(screen.getByRole('navigation', { name: '主导航' }).closest('aside')).toHaveClass(
      'app-layout__sidebar--open',
    )
    // 展开时出现遮罩
    expect(document.querySelector('.app-layout__scrim')).not.toBeNull()
  })

  it('点击抽屉中的导航项后抽屉收起', async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    await user.click(queryMoreButton())
    expect(queryMoreButton()).toHaveAttribute('aria-expanded', 'true')

    // 侧边导航（抽屉内）的「日历」不在 TabBar 高频页中，点击后应关闭抽屉
    await user.click(screen.getByRole('link', { name: '日历' }))

    expect(queryMoreButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('按 Escape 关闭抽屉并移除遮罩', async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    await user.click(queryMoreButton())
    expect(document.querySelector('.app-layout__scrim')).not.toBeNull()

    await user.keyboard('{Escape}')

    expect(queryMoreButton()).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.app-layout__scrim')).toBeNull()
  })

  it('点击遮罩也关闭抽屉', async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    await user.click(queryMoreButton())
    const scrim = document.querySelector('.app-layout__scrim') as HTMLElement
    await user.click(scrim)

    expect(queryMoreButton()).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.app-layout__scrim')).toBeNull()
  })

  it('TabBar 包含 4 个高频页直达链接，「更多」仅开抽屉不导航', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    const tabbar = screen.getByRole('navigation', { name: '移动端主导航' })
    expect(tabbar).toBeInTheDocument()
    for (const label of ['仪表盘', '记录', '统计', '路线']) {
      expect(within(tabbar).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})