import { render, screen } from '@testing-library/react'
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
 * 移动端抽屉式导航测试。
 * jsdom 无法感知媒体查询下 computed style（CSS 未真正布局），汉堡按钮因
 * base 样式 display:none 对默认 getByRole 不可见。用 { hidden: true } 查询，
 * 通过 aria-expanded / 遮罩 DOM 断言开合逻辑（不依赖 CSS 位移）。
 */
describe('AppLayout 移动端抽屉导航', () => {
  const user = userEvent.setup()

  /** 查询汉堡按钮（jsdom 下 base 样式 display:none，需 hidden:true 才能命中） */
  const queryMenuButton = () =>
    screen.getByRole('button', { name: '打开菜单', hidden: true })

  it('汉堡按钮默认收起（aria-expanded=false），点击展开并出现遮罩', async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    const menuButton = queryMenuButton()
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton).toHaveAttribute('aria-controls', 'app-nav')

    await user.click(menuButton)

    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    // 抽屉获得 open class（DOM 始终渲染，靠 class 表达开合）
    expect(screen.getByRole('navigation', { name: '主导航' }).closest('aside')).toHaveClass(
      'app-layout__sidebar--open',
    )
    // 展开时出现遮罩
    expect(document.querySelector('.app-layout__scrim')).not.toBeNull()
  })

  it('点击导航项后抽屉收起', async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    const menuButton = queryMenuButton()
    await user.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('link', { name: '统计' }))

    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('按 Escape 关闭抽屉并移除遮罩', async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    const menuButton = queryMenuButton()
    await user.click(menuButton)
    expect(document.querySelector('.app-layout__scrim')).not.toBeNull()

    await user.keyboard('{Escape}')

    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.app-layout__scrim')).toBeNull()
  })

  it('点击遮罩也关闭抽屉', async () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    )

    await user.click(queryMenuButton())
    const scrim = document.querySelector('.app-layout__scrim') as HTMLElement
    await user.click(scrim)

    expect(queryMenuButton()).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.app-layout__scrim')).toBeNull()
  })
})