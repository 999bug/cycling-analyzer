/**
 * 区块 / 路由级错误边界测试。
 *
 * 核心断言是这次下沉的**目的**：某个页面或区块渲染失败时，
 * 页面其余部分（这里是模拟的侧边栏）必须仍然可用，而不是整页变错误页。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { RouteBoundary, SectionBoundary } from '@/components/SectionBoundary'

vi.mock('@/utils/navigation', () => ({
  reloadPage: vi.fn(),
}))

/** 抛错的页面 */
function BrokenPage(): ReactElement {
  throw new Error('page boom')
}

/** 正常页面 */
function FinePage(): ReactElement {
  return <p>另一个页面的内容</p>
}

describe('区块 / 路由级错误边界', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('SectionBoundary 降级时同层其它区块不受影响', () => {
    render(
      <div>
        <p>同层兄弟区块</p>
        <SectionBoundary scope="图表">
          <BrokenPage />
        </SectionBoundary>
      </div>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('这部分内容加载失败')
    // 关键：兄弟区块仍在
    expect(screen.getByText('同层兄弟区块')).toBeInTheDocument()
  })

  it('RouteBoundary 降级只影响内容区，布局（侧边栏）保持可用', () => {
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <p>侧边栏导航</p>
        <RouteBoundary>
          <Routes>
            <Route path="/broken" element={<BrokenPage />} />
          </Routes>
        </RouteBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('这个页面出错了')
    expect(screen.getByText('侧边栏导航')).toBeInTheDocument()
  })

  it('RouteBoundary 以 pathname 为 key：切换路由后错误态自动清空', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <RouteBoundary>
          <Routes>
            <Route path="/broken" element={<BrokenPage />} />
            <Route path="/fine" element={<FinePage />} />
          </Routes>
        </RouteBoundary>
        <Link to="/fine">去正常页</Link>
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('这个页面出错了')

    await user.click(screen.getByRole('link', { name: '去正常页' }))

    // 换新 boundary 实例：错误态不残留，正常页渲染出来
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('另一个页面的内容')).toBeInTheDocument()
  })
})
