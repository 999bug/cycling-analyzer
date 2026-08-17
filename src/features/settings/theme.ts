/**
 * 主题切换（规格 §36）：把主题写入 <html> 的 data-theme 属性，
 * CSS 通过 :root[data-theme='light'] 覆盖变量实现浅色主题。
 *
 * 应用启动时 main.tsx 调用 initTheme 读取持久化设置；
 * 设置页切换主题时调用 applyTheme 立即生效。
 */
import { getSettings, saveSettings, type Theme } from '@/features/settings/settings'
import type { SettingsRepository } from '@/storage/repositories/settingsRepository'

/**
 * 应用主题到文档根元素（data-theme 属性驱动 CSS 变量切换）。
 *
 * @param theme 主题
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
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
