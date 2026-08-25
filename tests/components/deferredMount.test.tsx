/**
 * DeferredMount 视口懒挂载测试：jsdom 无 IntersectionObserver 时立即渲染
 * （退化兼容），有 IO 时视口外渲染占位块、进入后挂载 children。
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeferredMount } from '@/components/DeferredMount'

describe('DeferredMount 视口懒挂载', () => {
  it('jsdom 无 IntersectionObserver：立即渲染 children（退化兼容）', () => {
    // jsdom 环境无 IntersectionObserver，useInView 初始化即 true
    render(
      <DeferredMount minHeight={280} placeholderLabel="图表">
        <div>图表内容</div>
      </DeferredMount>,
    )

    expect(screen.getByText('图表内容')).toBeInTheDocument()
    expect(screen.queryByLabelText('图表')).not.toBeInTheDocument()
  })

  it('有 IntersectionObserver：视口外先占位，进入视口后挂载', async () => {
    const observers: MockIO[] = []
    class MockIO {
      callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
        observers.push(this)
      }
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
      takeRecords = (): IntersectionObserverEntry[] => []
      root: Element | Document | null = null
      rootMargin = ''
      thresholds: readonly number[] = []
    }
    vi.stubGlobal('IntersectionObserver', MockIO as unknown as typeof IntersectionObserver)

    const { queryByText } = render(
      <DeferredMount minHeight={200} placeholderLabel="数据曲线">
        <div>延迟内容</div>
      </DeferredMount>,
    )

    // 视口外：占位块存在，children 未挂载
    expect(queryByText('延迟内容')).toBeNull()
    expect(screen.getByLabelText('数据曲线')).toBeInTheDocument()

    // 模拟进入视口
    observers[0]!.callback(
      [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
      observers[0] as unknown as IntersectionObserver,
    )
    await waitFor(() => expect(queryByText('延迟内容')).not.toBeNull())
    vi.unstubAllGlobals()
  })
})
