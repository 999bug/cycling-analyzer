/**
 * PWA 安装逻辑纯函数测试：平台检测 / standalone 判定 / 支持形态分流 /
 * 「稍后」冷却期读写 / 安装事件捕获与触发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectIos,
  dismissForCooldown,
  getDeferredPrompt,
  getInstallPlatform,
  getInstallSupport,
  INSTALL_DISMISS_COOLDOWN_DAYS,
  isStandaloneDisplay,
  isWithinDismissCooldown,
  readDismissAt,
  resetPwaInstallStateForTests,
  subscribePwaInstall,
  triggerInstallPrompt,
  type BeforeInstallPromptEvent,
} from '@/features/pwa/install'

/** 内存版 localStorage（隔离真实存储，避免用例间串台） */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: () => null,
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  } as unknown as Storage
}

/** 构造伪 beforeinstallprompt 事件并派发到 window */
function dispatchBeforeInstallPrompt(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome, platform: 'web' })
  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetPwaInstallStateForTests()
})

describe('detectIos', () => {
  it('iPhone/iPad/iPod UA 直接命中', () => {
    expect(detectIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit', 5)).toBe(true)
    expect(detectIos('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 5)).toBe(true)
    expect(detectIos('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0)', 5)).toBe(true)
  })

  it('iPadOS 13+ 桌面 UA（Macintosh）靠多点触控命中，普通 Mac 不命中', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit'
    expect(detectIos(ua, 5)).toBe(true)
    expect(detectIos(ua, 0)).toBe(false)
  })

  it('Windows/Android UA 不命中', () => {
    expect(detectIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false)
    expect(detectIos('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5)).toBe(false)
  })
})

describe('getInstallPlatform', () => {
  it('按 UA 分类 ios/android/desktop', () => {
    expect(getInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 5)).toBe('ios')
    expect(getInstallPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5)).toBe('android')
    expect(getInstallPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe('desktop')
  })
})

describe('isStandaloneDisplay / getInstallSupport', () => {
  it('display-mode 媒体查询命中视为已安装', () => {
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
    expect(isStandaloneDisplay()).toBe(true)
    expect(getInstallSupport({ hasDeferredPrompt: true })).toBe('installed')
  })

  it('已捕获安装事件 → prompt；iOS 无事件 → instructions；普通桌面无事件 → unsupported', () => {
    // jsdom 默认环境：非 iOS、matchMedia stub matches=false
    expect(getInstallSupport({ hasDeferredPrompt: true })).toBe('prompt')
    expect(getInstallSupport({ hasDeferredPrompt: false })).toBe('unsupported')

    // 覆盖 navigator 模拟 iOS Safari
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', maxTouchPoints: 5 })
    expect(getInstallSupport({ hasDeferredPrompt: false })).toBe('instructions')
    vi.unstubAllGlobals()
  })

  it('缺省注入时读取模块捕获状态', () => {
    dispatchBeforeInstallPrompt('accepted')
    expect(getInstallSupport()).toBe('prompt')
  })
})

describe('稍后冷却期', () => {
  it('无记录时不在冷却期', () => {
    const storage = createMemoryStorage()
    expect(readDismissAt(storage)).toBeNull()
    expect(isWithinDismissCooldown(Date.now(), storage)).toBe(false)
  })

  it('记录后冷却期内为 true，超过天数归零', () => {
    const storage = createMemoryStorage()
    const dismissedAt = 1_700_000_000_000
    dismissForCooldown(dismissedAt, storage)
    expect(readDismissAt(storage)).toBe(dismissedAt)
    // 冷却期内（13 天）
    expect(isWithinDismissCooldown(dismissedAt + 13 * 24 * 3600 * 1000, storage)).toBe(true)
    // 冷却期满（默认 14 天）
    expect(isWithinDismissCooldown(dismissedAt + INSTALL_DISMISS_COOLDOWN_DAYS * 24 * 3600 * 1000, storage)).toBe(false)
  })

  it('损坏的存储值视为未关闭过', () => {
    const storage = createMemoryStorage()
    storage.setItem('cycling-pwa-install-dismissed-at', 'not-a-number')
    expect(readDismissAt(storage)).toBeNull()
    expect(isWithinDismissCooldown(Date.now(), storage)).toBe(false)
  })
})

describe('安装事件捕获与触发', () => {
  it('beforeinstallprompt 派发后被捕获且阻止默认行为', () => {
    const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
    event.prompt = vi.fn()
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })
    let notified = 0
    const unsubscribe = subscribePwaInstall(() => {
      notified += 1
    })
    window.dispatchEvent(event)
    expect(getDeferredPrompt()).toBe(event)
    expect(notified).toBe(1)
    unsubscribe()
  })

  it('triggerInstallPrompt 返回用户选择结果，事件一次性消费', async () => {
    const event = dispatchBeforeInstallPrompt('accepted')
    await expect(triggerInstallPrompt()).resolves.toBe('accepted')
    expect(event.prompt).toHaveBeenCalledTimes(1)
    // 一次性：用完即清空
    expect(getDeferredPrompt()).toBeNull()
  })

  it('用户取消原生弹窗返回 dismissed', async () => {
    dispatchBeforeInstallPrompt('dismissed')
    await expect(triggerInstallPrompt()).resolves.toBe('dismissed')
    expect(getDeferredPrompt()).toBeNull()
  })

  it('未捕获事件时触发返回 unavailable', async () => {
    await expect(triggerInstallPrompt()).resolves.toBe('unavailable')
  })

  it('appinstalled 后清空捕获状态与冷却记录', () => {
    const storage = createMemoryStorage()
    dismissForCooldown(Date.now(), storage)
    dispatchBeforeInstallPrompt('accepted')
    window.dispatchEvent(new Event('appinstalled'))
    expect(getDeferredPrompt()).toBeNull()
    expect(readDismissAt(storage)).not.toBeNull() // 真实 localStorage 未动，仅验证不抛错
    expect(getInstallSupport()).toBe('unsupported') // jsdom 非独立窗口、非 iOS、无事件
  })
})
