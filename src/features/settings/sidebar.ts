/**
 * 侧边栏行为偏好（固定 / 自动收回）。
 *
 * 持久化落在 settings 表 appearance.sidebarMode，运行时镜像在 uiStore：
 * 启动时 initSidebarMode 读设置写入 store（main.tsx 调用一次）；
 * 设置页下拉与侧边栏图钉按钮改设置时调用 switchSidebarMode，
 * 先更新 store 让布局立即响应，再异步落库——两处入口共用同一条路径。
 */
import { getSettings, saveSettings, type SidebarMode } from '@/features/settings/settings'
import { useUiStore } from '@/stores/uiStore'
import type { SettingsRepository } from '@/storage/repositories/settingsRepository'

/**
 * 初始化侧边栏行为：读取持久化设置并写入 uiStore。
 * 读取失败保持默认「固定」；无论成败都标记已就绪（解除过渡抑制）。
 *
 * @param settingsRepository 设置仓库（测试注入独立实例）
 */
export async function initSidebarMode(
  settingsRepository?: SettingsRepository,
): Promise<void> {
  try {
    const settings = await getSettings(settingsRepository)
    useUiStore.getState().setSidebarMode(settings.appearance.sidebarMode)
  } catch (error) {
    console.error('Failed to initialize sidebar mode', error)
  } finally {
    useUiStore.getState().setSidebarHydrated()
  }
}

/**
 * 切换侧边栏行为：先更新 uiStore 立即生效，再持久化。
 *
 * @param mode 目标行为（fixed / auto）
 * @param settingsRepository 设置仓库（测试注入独立实例）
 */
export async function switchSidebarMode(
  mode: SidebarMode,
  settingsRepository?: SettingsRepository,
): Promise<void> {
  useUiStore.getState().setSidebarMode(mode)
  await saveSettings({ appearance: { sidebarMode: mode } }, settingsRepository)
}
