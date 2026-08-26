/**
 * PWA 安装引导横幅组件测试：展示条件 / 一键安装流程 /
 * iOS 手动步骤形态 / 稍后冷却。
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InstallBanner from '@/components/InstallBanner'
import {
  INSTALL_DISMISS_STORAGE_KEY,
  resetPwaInstallStateForTests,
  type BeforeInstallPromptEvent,
} from '@/features/pwa/install'

/** 派发伪 beforeinstallprompt 事件（模块级监听捕获） */
function dispatchPrompt(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome, platform: 'web' })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

beforeEach(() => {
  localStorage.clear()
  resetPwaInstallStateForTests()
})

describe('InstallBanner', () => {
  it('环境不支持时不渲染', () => {
    // jsdom 默认：非 iOS、无安装事件、非 standalone
    const { container } = render(<InstallBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('捕获到安装事件后展示一键安装，点击触发原生弹窗', async () => {
    const user = userEvent.setup()
    const event = dispatchPrompt('accepted')
    render(<InstallBanner />)

    expect(screen.getByRole('complementary', { name: '安装骑了么应用' })).toBeInTheDocument()
    expect(screen.getByText('把骑了么安装成应用')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '立即安装' }))
    expect(event.prompt).toHaveBeenCalledTimes(1)
  })

  it('用户取消原生弹窗进入冷却期，横幅消失并记录时间戳', async () => {
    const user = userEvent.setup()
    dispatchPrompt('dismissed')
    render(<InstallBanner />)

    await user.click(screen.getByRole('button', { name: '立即安装' }))

    expect(screen.queryByRole('complementary', { name: '安装骑了么应用' })).not.toBeInTheDocument()
    // 冷却时间戳已写入 localStorage
    expect(localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY)).not.toBeNull()
  })

  it('点击「稍后」进冷却期，不再打扰', async () => {
    const user = userEvent.setup()
    dispatchPrompt('accepted')
    render(<InstallBanner />)

    await user.click(screen.getByRole('button', { name: '稍后' }))

    expect(screen.queryByRole('complementary', { name: '安装骑了么应用' })).not.toBeInTheDocument()
    expect(localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY)).not.toBeNull()
  })

  it('已安装（standalone 运行）时不渲染', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('standalone'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    )
    const { container } = render(<InstallBanner />)
    expect(container).toBeEmptyDOMElement()
    vi.restoreAllMocks()
  })

  it('iOS Safari 展示手动步骤而非一键安装按钮', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', maxTouchPoints: 5 })
    render(<InstallBanner />)

    expect(screen.getByText(/在 Safari 底部点击「分享」按钮/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '立即安装' })).not.toBeInTheDocument()
    // iOS 形态的关闭按钮文案为「知道了」
    expect(screen.getByRole('button', { name: '知道了' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('appinstalled 后横幅自动消失', () => {
    dispatchPrompt('accepted')
    render(<InstallBanner />)
    expect(screen.getByRole('complementary', { name: '安装骑了么应用' })).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(screen.queryByRole('complementary', { name: '安装骑了么应用' })).not.toBeInTheDocument()
  })
})
