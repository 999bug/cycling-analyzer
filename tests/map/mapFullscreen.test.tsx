/**
 * 地图全屏按钮测试（PWA 独立窗口伪全屏降级）。
 *
 * - 浏览器标签页（非 standalone）：点击调用原生 requestFullscreen，被拒时降级伪全屏；
 * - PWA 独立窗口（standalone）：点击走伪全屏（加 map-fullscreen-pseudo 类），
 *   不碰原生 Fullscreen API（Android 独立窗口下原生全屏会整页卡死，crbug 1232956 系）；
 * - 再次点击退出伪全屏；返回手势（popstate）也能退出；卸载兜底摘类。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MapFullscreenButton } from '@/map/mapFullscreen'
import { MAP_PSEUDO_FULLSCREEN_CLASS, isPseudoFullscreen } from '@/map/pseudoFullscreen'

/** 构造 MediaQueryList stub（jsdom 无真实实现，按用例需要指定 matches） */
function makeMql(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '(display-mode: standalone)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
}

/**
 * 渲染带全屏包裹层与按钮的最小组件树。
 * 返回包裹层元素（container 首子节点，unmount 后依然持有，供卸载断言用）
 * 与 requestFullscreen stub 的挂载点。
 */
function renderFullscreenButton() {
  const targetRef = createRef<HTMLDivElement>()
  const { container } = render(
    <div ref={targetRef}>
      <MapFullscreenButton targetRef={targetRef} />
    </div>,
  )
  // 包裹层元素从 container 取（unmount 后依然持有，供卸载断言用）
  const wrapperEl = container.firstElementChild as HTMLElement
  const requestFullscreen = vi.fn(() => Promise.resolve())
  Object.defineProperty(wrapperEl, 'requestFullscreen', {
    value: requestFullscreen,
    configurable: true,
  })
  return { wrapperEl, requestFullscreen }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MapFullscreenButton', () => {
  it('独立窗口（standalone）点击走伪全屏，不碰原生 Fullscreen API', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(makeMql(true))
    const { wrapperEl, requestFullscreen } = renderFullscreenButton()

    await userEvent.click(screen.getByRole('button', { name: '全屏查看' }))

    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(true)
    expect(screen.getByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  })

  it('浏览器标签页（非 standalone）点击调用原生 requestFullscreen', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(makeMql(false))
    const { wrapperEl, requestFullscreen } = renderFullscreenButton()

    await userEvent.click(screen.getByRole('button', { name: '全屏查看' }))

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(isPseudoFullscreen(wrapperEl)).toBe(false)
  })

  it('原生全屏被拒（NotAllowedError）时降级伪全屏', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(makeMql(false))
    const { wrapperEl, requestFullscreen } = renderFullscreenButton()
    // mockImplementation（而非 mockReturnValue）：调用时才创建 rejected promise，
    // 组件同步 .catch 接住；急切创建会在点击前就被判为 unhandled rejection
    requestFullscreen.mockImplementation(() =>
      Promise.reject(new DOMException('denied', 'NotAllowedError')),
    )

    await userEvent.click(screen.getByRole('button', { name: '全屏查看' }))
    // 等待 rejection 走进降级分支
    await act(async () => {
      await Promise.resolve()
    })

    expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(true)
  })

  it('伪全屏态再次点击退出，类名摘除、按钮还原', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(makeMql(true))
    const { wrapperEl } = renderFullscreenButton()

    await userEvent.click(screen.getByRole('button', { name: '全屏查看' }))
    expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: '退出全屏' }))

    expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(false)
    expect(screen.getByRole('button', { name: '全屏查看' })).toBeInTheDocument()
  })

  it('伪全屏态返回手势（popstate）退出全屏', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(makeMql(true))
    const { wrapperEl } = renderFullscreenButton()

    await userEvent.click(screen.getByRole('button', { name: '全屏查看' }))
    expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(true)

    // jsdom 的 popstate 异步派发，用 waitFor 轮询等待退出生效
    await act(async () => {
      history.back()
      await vi.waitFor(() => {
        expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(false)
      })
    })

    expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(false)
  })

  it('卸载兜底：伪全屏态下组件卸载时摘掉覆盖类', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(makeMql(true))
    const { wrapperEl } = renderFullscreenButton()

    await userEvent.click(screen.getByRole('button', { name: '全屏查看' }))
    expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(true)

    cleanup()

    expect(wrapperEl.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS)).toBe(false)
  })
})
