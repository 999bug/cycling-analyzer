/**
 * ErrorBoundary 测试。
 *
 * 验证：
 * - 正常 children 透传不渲染降级页
 * - 子组件抛错时降级页出现（标题 + 重新加载按钮）
 * - 降级页按钮可点击且不抛错（reload 本身在 jsdom 不可 stub）
 *
 * 注：React 18 内部对 console.error 做了引用缓存，spy 难以稳定验证；
 * componentDidCatch 日志的主要价值是线上聚合——测试不强制覆盖。
 */
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/** 用于测试的子组件：通过 prop 触发抛错 */
function Bomb({ shouldThrow }: { shouldThrow: boolean }): ReactElement {
  if (shouldThrow) {
    throw new Error('boom')
  }
  return <p>正常内容</p>
}

describe('ErrorBoundary', () => {
  // React 在边界捕获错误时输出堆栈到 console.error；
  // 抑制避免测试输出污染，但不影响断言。
  beforeEach(() => {
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

  it('点击重新加载按钮不抛错（reload 在 jsdom 为空实现）', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    // jsdom 的 location.reload 是不可 stub 的只读属性，
    // 仅验证点击不抛错——实际 reload 行为依赖浏览器
    await expect(
      user.click(screen.getByRole('button', { name: '重新加载' })),
    ).resolves.not.toThrow()
  })
})
