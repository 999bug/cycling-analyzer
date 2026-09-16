/**
 * ErrorBoundary 测试。
 *
 * 验证：
 * - 正常 children 透传不渲染降级页
 * - 子组件抛错时降级页出现（标题 + 重新加载按钮）
 * - 降级页按钮点击触发整页刷新（经 @/utils/navigation mock 断言）
 * - section 变体：内联降级、可重试恢复、不遮挡页面其余部分
 *
 * 注：React 18 内部对 console.error 做了引用缓存，spy 难以稳定验证；
 * componentDidCatch 日志的主要价值是线上聚合——测试不强制覆盖。
 */
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { reloadPage } from '@/utils/navigation'

// reload 经 @/utils/navigation 间接调用（jsdom 的 location.reload 不可 stub）
vi.mock('@/utils/navigation', () => ({
  reloadPage: vi.fn(),
}))

/** 用于测试的子组件：通过 prop 触发抛错 */
function Bomb({ shouldThrow }: { shouldThrow: boolean }): ReactElement {
  if (shouldThrow) {
    throw new Error('boom')
  }
  return <p>正常内容</p>
}

/** 可通过外部开关「修好」的炸弹组件（用于验证重试真的重挂载了子树） */
let switchableArmed = false
function SwitchableBomb(): ReactElement {
  if (switchableArmed) {
    throw new Error('boom')
  }
  return <p>恢复后的内容</p>
}

describe('ErrorBoundary', () => {
  // React 在边界捕获错误时输出堆栈到 console.error；
  // 抑制避免测试输出污染，但不影响断言。
  beforeEach(() => {
    // reloadPage 是模块级 vi.fn()，不受 restoreAllMocks 影响——不显式清理的话
    // 调用次数会跨用例累积，「断言调用 1 次」的用例会随用例顺序飘
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('正常子组件时不渲染降级页', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常内容')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('子组件抛错时降级页出现且包含重新加载按钮', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('页面出错了')
    expect(alert).toHaveTextContent('重新加载')
    expect(screen.queryByText('正常内容')).not.toBeInTheDocument()
  })

  it('点击重新加载按钮调用整页刷新', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: '重新加载' }))

    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  describe('variant="section"（区块级降级）', () => {
    it('内联渲染降级卡，操作是「重试 / 刷新页面」而非整页重载', () => {
      render(
        <ErrorBoundary variant="section" scope="地图">
          <Bomb shouldThrow={true} />
        </ErrorBoundary>,
      )

      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('error-boundary--section')
      expect(alert).toHaveTextContent('这部分内容加载失败')
      expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument()
      // 区块级不得出现全屏重载按钮，否则等于把整页降级
      expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument()
    })

    it('点「重试」重挂载子树：条件恢复后内容重新渲染', async () => {
      const user = userEvent.setup()
      switchableArmed = true
      render(
        <ErrorBoundary variant="section" scope="图表">
          <SwitchableBomb />
        </ErrorBoundary>,
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()

      // 模拟「偶发原因已消失」，再点重试
      switchableArmed = false
      await user.click(screen.getByRole('button', { name: '重试' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByText('恢复后的内容')).toBeInTheDocument()
    })

    it('点「刷新页面」走整页重载', async () => {
      const user = userEvent.setup()
      render(
        <ErrorBoundary variant="section" scope="地图">
          <Bomb shouldThrow={true} />
        </ErrorBoundary>,
      )

      await user.click(screen.getByRole('button', { name: '刷新页面' }))

      expect(reloadPage).toHaveBeenCalledTimes(1)
    })

    it('支持自定义标题与说明（区块文案比通用文案更有定位价值）', () => {
      render(
        <ErrorBoundary
          variant="section"
          scope="地图"
          title="地图渲染失败"
          description="轨迹数据已加载，但地图组件出错。"
        >
          <Bomb shouldThrow={true} />
        </ErrorBoundary>,
      )

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('地图渲染失败')
      expect(alert).toHaveTextContent('轨迹数据已加载，但地图组件出错。')
    })
  })
})
