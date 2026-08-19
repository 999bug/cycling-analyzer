/**
 * 主题切换（规格 §36）：把主题写入 <html> 的 data-theme 属性，
 * CSS 通过 :root[data-theme='light'] 覆盖变量实现浅色主题。
 *
 * system 模式：解析 prefers-color-scheme 并监听变化自动跟随（JS 层映射，
 * CSS 仍由 data-theme 驱动，浅色/深色覆盖结构不变）。
 * 应用启动时 main.tsx 调用 initTheme 读取持久化设置；
 * 设置页切换主题时调用 applyTheme 立即生效。
 */
import { getSettings, saveSettings, type Theme } from '@/features/settings/settings'
import type { SettingsRepository } from '@/storage/repositories/settingsRepository'

/** 系统主题监听器（跟随系统模式时挂载，切换模式/重复调用防泄漏） */
let systemThemeListener: ((event: MediaQueryListEvent) => void) | null = null

/** 系统浅色偏好媒体查询 */
const LIGHT_MEDIA = '(prefers-color-scheme: light)'

/**
 * 应用主题到文档根元素（data-theme 属性驱动 CSS 变量切换）。
 * system 模式解析系统偏好并挂载监听自动跟随。
 *
 * @param theme 主题（含跟随系统）
 */
export function applyTheme(theme: Theme): void {
  if (theme !== 'system') {
    // 显式主题：卸载系统监听，直接应用
    if (systemThemeListener !== null) {
      window.matchMedia(LIGHT_MEDIA).removeEventListener('change', systemThemeListener)
      systemThemeListener = null
    }
    document.documentElement.dataset.theme = theme
    return
  }

  const media = window.matchMedia(LIGHT_MEDIA)
  document.documentElement.dataset.theme = media.matches ? 'light' : 'dark'
  if (systemThemeListener === null) {
    systemThemeListener = (event) => {
      document.documentElement.dataset.theme = event.matches ? 'light' : 'dark'
    }
    media.addEventListener('change', systemThemeListener)
  }
}

/**
 * 初始化主题：读取持久化设置并应用（应用启动时调用一次）。
 */
export async function initTheme(): Promise<void> {
  try {
    const settings = await getSettings()
    applyTheme(settings.appearance.theme)
  } catch (error) {
    console.error('Failed to initialize theme', error)
  }
}

/**
 * 切换主题：立即应用并持久化。
 *
 * @param theme 新主题
 * @param settingsRepository 设置仓库（测试注入独立实例）
 */
export async function switchTheme(
  theme: Theme,
  settingsRepository?: SettingsRepository,
): Promise<void> {
  applyTheme(theme)
  await saveSettings({ appearance: { theme } }, settingsRepository)
}
