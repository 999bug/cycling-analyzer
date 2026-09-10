/**
 * 界面偏好 store（侧边栏行为）。
 *
 * 持久化落在 settings 表（appearance.sidebarMode，与主题同域，见 features/settings/sidebar.ts），
 * 这里只保存供组件订阅的运行时镜像：启动时 initSidebarMode 读设置写入，
 * 设置页下拉与侧边栏图钉按钮改设置时同步更新，二者状态天然一致。
 *
 * sidebarHydrated：首次读取是否完成。未完成前按默认固定渲染并禁用侧栏宽度过渡，
 * 避免异步读到「自动收回」时出现「先展开再收起」的启动闪动。
 */
import { create } from 'zustand'
import type { SidebarMode } from '@/features/settings/settings'

/** 侧边栏偏好 store 状态与 actions */
export interface UiState {
  /** 桌面端侧边栏行为（默认固定常驻） */
  sidebarMode: SidebarMode

  /** 启动读取是否完成（false 时禁用侧栏宽度过渡，避免启动闪动） */
  sidebarHydrated: boolean

  /** 设置侧边栏行为（设置页下拉 / 侧边栏图钉按钮，立即生效） */
  setSidebarMode(mode: SidebarMode): void

  /** 标记启动读取完成（initSidebarMode 收尾调用，无论成功失败） */
  setSidebarHydrated(): void
}

/** 界面偏好 store 实例（无持久化：持久化由 settings 表负责） */
export const useUiStore = create<UiState>()((set) => ({
  sidebarMode: 'fixed',
  sidebarHydrated: false,
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  setSidebarHydrated: () => set({ sidebarHydrated: true }),
}))
