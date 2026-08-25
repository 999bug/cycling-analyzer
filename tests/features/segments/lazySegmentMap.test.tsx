/**
 * 迷你地图懒加载壳测试（GPX 导入卡死修复）。
 *
 * jsdom 无 IntersectionObserver：stub 一个可手动触发的假实现，
 * 验证视口外渲染占位块、触发相交后挂载地图。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LazySegmentMap } from '@/features/segments/LazySegmentMap'

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void

/** 可手动触发相交回调的假 IntersectionObserver */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  constructor(callback: ObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }

  callback: ObserverCallback

  observe(): void {}

  disconnect(): void {}

  unobserve(): void {}
}

describe('LazySegmentMap', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver)
    FakeIntersectionObserver.instances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('进入视口前只渲染占位块，不挂载地图 children', () => {
    render(
      <LazySegmentMap placeholderLabel="占位">
        <div data-testid="real-map">map</div>
      </LazySegmentMap>,
    )
    expect(screen.queryByTestId('real-map')).not.toBeInTheDocument()
    expect(screen.getByLabelText('占位')).toBeInTheDocument()
    expect(FakeIntersectionObserver.instances).toHaveLength(1)
  })

  it('IntersectionObserver 触发相交后挂载真实地图并断开观察', () => {
    render(
      <LazySegmentMap>
        <div data-testid="real-map">map</div>
      </LazySegmentMap>,
    )
    const instance = FakeIntersectionObserver.instances[0]!
    const disconnectSpy = vi.spyOn(instance, 'disconnect')
    act(() => {
      instance.callback([{ isIntersecting: true }])
    })
    expect(screen.getByTestId('real-map')).toBeInTheDocument()
    expect(disconnectSpy).toHaveBeenCalled()
  })
})