/**
 * PWA 安装引导（规格外：移动端入口改走 Web 安装体验，替代小程序线）。
 *
 * 三类环境分流：
 * - Chromium 系（Chrome/Edge/安卓 Chrome）：全局监听 beforeinstallprompt 捕获安装事件
 *   （事件可能早于 React 挂载触发，必须在模块加载时注册监听），由自定义 UI
 *   （全局横幅/设置页按钮）择机调用 prompt() 触发原生安装弹窗；
 * - iOS Safari：不支持 beforeinstallprompt，展示「分享 → 添加到主屏幕」手动步骤；
 * - 已安装（standalone 独立窗口运行）：所有引导隐藏。
 *
 * 「稍后」采用 14 天冷却期（localStorage 时间戳），到期后横幅重新出现一次，
 * 既不永久打扰也不错过转化窗口；安装成功自动清除冷却记录。
 */

/** 安装支持形态 */
export type InstallSupport =
  /** 已以独立窗口运行（standalone/fullscreen/minimal-ui 或 iOS standalone） */
  | 'installed'
  /** 可编程触发原生安装弹窗（已捕获 beforeinstallprompt 事件） */
  | 'prompt'
  /** 仅支持手动添加步骤（iOS Safari 等无 beforeinstallprompt 的可安装环境） */
  | 'instructions'
  /** 当前环境既无可编程安装也无手动路径（引导全部隐藏） */
  | 'unsupported'

/** 平台分类（决定横幅文案：主屏幕 vs 桌面） */
export type InstallPlatform = 'ios' | 'android' | 'desktop'

/** BeforeInstallPromptEvent（TS DOM lib 未内置，定义最小接口便于测试注入） */
export interface BeforeInstallPromptEvent extends Event {
  /** 弹出浏览器原生安装确认框 */
  prompt: () => Promise<void>
  /** 用户在原生弹窗中的选择 */
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

/** 触发安装弹窗的结果 */
export type PromptOutcome = 'accepted' | 'dismissed' | 'unavailable'

// ---------- 平台与显示形态检测 ----------

/** iOS 家族 UA（iPhone/iPad/iPod 直接命中） */
const IOS_UA_RE = /iphone|ipad|ipod/i

/** iPadOS 13+ 伪装桌面 UA（Macintosh），靠多点触控区分 */
const MAC_UA_RE = /macintosh/i

/** Android UA */
const ANDROID_UA_RE = /android/i

/**
 * 判定是否 iOS/iPadOS 设备。
 *
 * @param userAgent navigator.userAgent
 * @param maxTouchPoints navigator.maxTouchPoints（iPadOS 判定依据）
 */
export function detectIos(userAgent: string, maxTouchPoints: number): boolean {
  if (IOS_UA_RE.test(userAgent)) {
    return true
  }
  return MAC_UA_RE.test(userAgent) && maxTouchPoints > 1
}

/**
 * 是否已以独立窗口运行（用户视角的「已安装」）。
 * 标准显示模式任一命中即算；iOS 主屏快捷方式走 navigator.standalone。
 */
export function isStandaloneDisplay(win: Window = window): boolean {
  const standaloneQuery = win.matchMedia?.(
    '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)',
  )
  if (standaloneQuery?.matches) {
    return true
  }
  // iOS Safari 专属字段（TS 未内置类型）
  const iosNavigator = win.navigator as Navigator & { standalone?: boolean }
  return iosNavigator.standalone === true
}

/** 当前平台分类 */
export function getInstallPlatform(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0),
): InstallPlatform {
  if (detectIos(userAgent, maxTouchPoints)) {
    return 'ios'
  }
  return ANDROID_UA_RE.test(userAgent) ? 'android' : 'desktop'
}

/**
 * 计算当前环境的安装支持形态。
 *
 * @param options.hasDeferredPrompt 注入「是否已捕获安装事件」（缺省读模块捕获状态）
 */
export function getInstallSupport(options?: { hasDeferredPrompt?: boolean }): InstallSupport {
  if (typeof window === 'undefined') {
    return 'unsupported'
  }
  if (isStandaloneDisplay()) {
    return 'installed'
  }
  const hasPrompt = options ? options.hasDeferredPrompt === true : getDeferredPrompt() !== null
  if (hasPrompt) {
    return 'prompt'
  }
  if (detectIos(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0),
  )) {
    return 'instructions'
  }
  return 'unsupported'
}

// ---------- 全局事件捕获（模块级单例，供横幅/设置页共享） ----------

/** 捕获到的 beforeinstallprompt 事件（一次性，prompt() 调用后即弃） */
let deferredPrompt: BeforeInstallPromptEvent | null = null

/** 状态变化订阅者（usePwaInstall hook 同步用） */
const stateListeners = new Set<() => void>()

function notifyStateChange(): void {
  stateListeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  // 阻止浏览器默认 mini-infobar，改由自定义 UI 择机触发
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    notifyStateChange()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    clearDismissRecord()
    notifyStateChange()
  })
}

/** 当前捕获的安装事件（无则 null） */
export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt
}

/** 订阅安装状态变化（beforeinstallprompt/appinstalled/触发后），返回取消订阅函数 */
export function subscribePwaInstall(listener: () => void): () => void {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

/**
 * 触发原生安装弹窗（仅 support === 'prompt' 时有意义）。
 * 事件一次性：调用后无论结果都清空捕获状态。
 */
export async function triggerInstallPrompt(): Promise<PromptOutcome> {
  const promptEvent = getDeferredPrompt()
  if (!promptEvent) {
    return 'unavailable'
  }
  try {
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    deferredPrompt = null
    notifyStateChange()
    if (choice.outcome === 'accepted') {
      clearDismissRecord()
    }
    return choice.outcome
  } catch (error) {
    // 部分浏览器在页面失焦等场景下 prompt() 会抛错，降级为不可用
    console.error('Failed to trigger install prompt', error)
    deferredPrompt = null
    notifyStateChange()
    return 'unavailable'
  }
}

// ---------- 「稍后」冷却期（localStorage 时间戳） ----------

/** 冷却期记录键（值为关闭时刻的毫秒时间戳） */
export const INSTALL_DISMISS_STORAGE_KEY = 'cycling-pwa-install-dismissed-at'

/** 冷却期天数：期内横幅不再出现，过期重新提示一次 */
export const INSTALL_DISMISS_COOLDOWN_DAYS = 14

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 读取最近一次「稍后」时刻（无记录/值损坏返回 null） */
export function readDismissAt(storage: Pick<Storage, 'getItem'> = localStorage): number | null {
  try {
    const raw = storage.getItem(INSTALL_DISMISS_STORAGE_KEY)
    if (raw === null) {
      return null
    }
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch {
    // 隐私模式等 localStorage 不可用场景：视为从未关闭过
    return null
  }
}

/** 是否仍在「稍后」冷却期内 */
export function isWithinDismissCooldown(
  now: number = Date.now(),
  storage: Pick<Storage, 'getItem'> = localStorage,
): boolean {
  const dismissedAt = readDismissAt(storage)
  if (dismissedAt === null) {
    return false
  }
  return now - dismissedAt < INSTALL_DISMISS_COOLDOWN_DAYS * MS_PER_DAY
}

/** 记录「稍后」：开启冷却期 */
export function dismissForCooldown(
  now: number = Date.now(),
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(INSTALL_DISMISS_STORAGE_KEY, String(now))
  } catch {
    // 写入失败不阻塞（同隐私模式兜底）
  }
}

/** 清除冷却记录（安装成功时调用） */
export function clearDismissRecord(
  storage: Pick<Storage, 'removeItem'> = localStorage,
): void {
  try {
    storage.removeItem(INSTALL_DISMISS_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** 仅测试用：重置模块级捕获状态（jsdom 跨用例串台防护） */
export function resetPwaInstallStateForTests(): void {
  deferredPrompt = null
  stateListeners.clear()
}
