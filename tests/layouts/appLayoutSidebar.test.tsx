/**
 * 桌面端侧边栏「固定 / 自动收回」行为测试。
 *
 * jsdom 不做真实布局（媒体查询与宽度过渡都不生效），因此断言基于 DOM 状态
 * （收起类名、展开按钮、inert）与交互时序（延迟收起与取消），不依赖像素。
 */
import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppLayout from '@/layouts/AppLayout'
import { initSidebarMode, switchSidebarMode } from '@/features/settings/sidebar'
import { useUiStore } from '@/stores/uiStore'
import { CyclingDatabase } from '@/storage/db'
import { DexieSettingsRepository } from '@/storage/repositories/settingsRepository'

/** 鼠标移出后的收起延迟（与 AppLayout 常量一致） */
const COLLAPSE_DELAY_MS = 300

/** 侧边栏根元素（id=app-nav） */
function sidebarElement(): HTMLElement {
  const element = document.getElementById('app-nav')
  if (element === null) {
    throw new Error('侧边栏未渲染')
  }
  return element
}

/** 侧栏内层容器 */
function sidebarInner(): HTMLElement {
  const element = sidebarElement().querySelector('.app-layout__sidebar-inner')
  if (element === null) {
    throw new Error('侧边栏内层未渲染')
  }
  return element as HTMLElement
}

/** 收起态判定（用类名代表宽度归零） */
function isCollapsed(): boolean {
  return sidebarElement().classList.contains('app-layout__sidebar--collapsed')
}

/** 渲染布局组件 */
function renderLayout() {
  return render(<AppLayout />, { wrapper: MemoryRouter })
}

describe('桌面端侧边栏行为', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarMode: 'fixed', sidebarHydrated: true })
  })

  it('默认固定：侧栏常驻、无抓条，图钉为按下态', () => {
    renderLayout()

    expect(isCollapsed()).toBe(false)
    expect(sidebarInner().hasAttribute('inert')).toBe(false)
    expect(screen.queryByRole('button', { name: '展开侧边栏' })).toBeNull()
    expect(screen.getByRole('button', { name: /固定常驻/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('自动收回：初始收起并显示展开按钮，内层 inert 挡住键盘焦点', () => {
    useUiStore.setState({ sidebarMode: 'auto' })
    renderLayout()

    expect(isCollapsed()).toBe(true)
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument()
    expect(sidebarInner().hasAttribute('inert')).toBe(true)
    // 品牌 logo 仍在侧栏内（由外层裁切而不可见），但已随 inert 退出键盘焦点序列
    expect(sidebarElement().querySelector('.app-layout__brand-logo')).not.toBeNull()
  })

  it('鼠标移入展开，移出延迟收起，延迟内移回则取消收起', () => {
    vi.useFakeTimers()
    try {
      useUiStore.setState({ sidebarMode: 'auto' })
      renderLayout()

      // 移入 → 立即展开，抓条退场
      act(() => {
        fireEvent.mouseEnter(sidebarElement())
      })
      expect(isCollapsed()).toBe(false)
      expect(screen.queryByRole('button', { name: '展开侧边栏' })).toBeNull()

      // 移出未满延迟 → 仍展开
      act(() => {
        fireEvent.mouseLeave(sidebarElement())
        vi.advanceTimersByTime(COLLAPSE_DELAY_MS - 100)
      })
      expect(isCollapsed()).toBe(false)

      // 延迟内移回 → 取消收起，再多等也不会收
      act(() => {
        fireEvent.mouseEnter(sidebarElement())
        vi.advanceTimersByTime(COLLAPSE_DELAY_MS * 2)
      })
      expect(isCollapsed()).toBe(false)

      // 再次移出并超过延迟 → 收起
      act(() => {
        fireEvent.mouseLeave(sidebarElement())
        vi.advanceTimersByTime(COLLAPSE_DELAY_MS)
      })
      expect(isCollapsed()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('展开按钮点击展开，Escape 立即收起', () => {
    useUiStore.setState({ sidebarMode: 'auto' })
    renderLayout()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    })
    expect(isCollapsed()).toBe(false)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(isCollapsed()).toBe(true)
  })

  it('展开按钮悬停或聚焦只高亮，不直接展开', () => {
    useUiStore.setState({ sidebarMode: 'auto' })
    renderLayout()

    const expandButton = screen.getByRole('button', { name: '展开侧边栏' })

    act(() => {
      fireEvent.mouseEnter(expandButton)
    })
    expect(isCollapsed()).toBe(true)

    act(() => {
      fireEvent.focus(expandButton)
    })
    expect(isCollapsed()).toBe(true)

    act(() => {
      fireEvent.click(expandButton)
    })
    expect(isCollapsed()).toBe(false)
  })

  it('键盘焦点进入侧栏保持展开，焦点移出后延迟收起', () => {
    vi.useFakeTimers()
    try {
      useUiStore.setState({ sidebarMode: 'auto' })
      renderLayout()

      const navLink = screen.getByRole('link', { name: '骑行记录', hidden: true })
      act(() => {
        fireEvent.focus(navLink)
      })
      expect(isCollapsed()).toBe(false)

      act(() => {
        fireEvent.blur(navLink, { relatedTarget: document.body })
        vi.advanceTimersByTime(COLLAPSE_DELAY_MS)
      })
      expect(isCollapsed()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('点击图钉切换为自动收回并同步运行时状态', async () => {
    renderLayout()

    const pin = screen.getByRole('button', { name: /固定常驻/ })
    await act(async () => {
      fireEvent.click(pin)
    })

    expect(useUiStore.getState().sidebarMode).toBe('auto')
    expect(screen.getByRole('button', { name: /自动收回/ })).toHaveAttribute('aria-pressed', 'false')
    expect(isCollapsed()).toBe(true)
  })

  it('切换回固定后侧栏恢复常驻', async () => {
    useUiStore.setState({ sidebarMode: 'auto' })
    renderLayout()
    expect(isCollapsed()).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /自动收回/ }))
    })

    expect(useUiStore.getState().sidebarMode).toBe('fixed')
    expect(isCollapsed()).toBe(false)
  })
})

describe('侧边栏偏好持久化', () => {
  it('切换后写入设置表，重新初始化可读回', async () => {
    const db = new CyclingDatabase()
    const repo = new DexieSettingsRepository(db)
    try {
      await switchSidebarMode('auto', repo)
      expect(useUiStore.getState().sidebarMode).toBe('auto')

      // 模拟下次启动：清空运行时镜像后重新读取
      useUiStore.setState({ sidebarMode: 'fixed', sidebarHydrated: false })
      await initSidebarMode(repo)

      expect(useUiStore.getState().sidebarMode).toBe('auto')
      expect(useUiStore.getState().sidebarHydrated).toBe(true)
    } finally {
      await db.delete()
    }
  })

  it('未设置过时回落到默认固定', async () => {
    const db = new CyclingDatabase()
    const repo = new DexieSettingsRepository(db)
    try {
      useUiStore.setState({ sidebarMode: 'auto', sidebarHydrated: false })
      await initSidebarMode(repo)

      expect(useUiStore.getState().sidebarMode).toBe('fixed')
      expect(useUiStore.getState().sidebarHydrated).toBe(true)
    } finally {
      await db.delete()
    }
  })
})
