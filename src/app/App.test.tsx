import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '@/app/App'

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
