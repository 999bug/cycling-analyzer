/**
 * usePwaInstall：PWA 安装状态的 React 接入。
 *
 * beforeinstallprompt 由 install.ts 模块级统一捕获（早于 React 挂载），
 * 本 hook 只订阅状态变化通知并派生视图状态；「稍后」冷却期在 dismiss 时
 * 同步写入本地 state，避免依赖 storage 事件。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  dismissForCooldown,
  getInstallPlatform,
  getInstallSupport,
  isWithinDismissCooldown,
  subscribePwaInstall,
  triggerInstallPrompt,
  type InstallPlatform,
  type InstallSupport,
  type PromptOutcome,
} from '@/features/pwa/install'

/** hook 暴露的安装状态 */
export interface PwaInstallState {
  /** 当前环境的安装支持形态 */
  support: InstallSupport

  /** 平台分类（文案用） */
  platform: InstallPlatform

  /** 是否处于「稍后」冷却期内 */
  coolingDown: boolean
}

/**
 * PWA 安装引导 hook：横幅与设置页共用同一份模块级状态。
 *
 * - `install()`：触发原生安装弹窗（仅 support === 'prompt' 有效）
 * - `dismiss()`：记录「稍后」进入 14 天冷却期
 */
export function usePwaInstall(): {
  support: InstallSupport
  platform: InstallPlatform
  coolingDown: boolean
  install: () => Promise<PromptOutcome>
  dismiss: () => void
} {
  const [state, setState] = useState<PwaInstallState>(() => ({
    support: getInstallSupport(),
    platform: getInstallPlatform(),
    coolingDown: isWithinDismissCooldown(),
  }))

  // 订阅模块级通知（beforeinstallprompt/appinstalled/触发后），全量重算派生状态
  useEffect(() => {
    const sync = () => {
      setState({
        support: getInstallSupport(),
        platform: getInstallPlatform(),
        coolingDown: isWithinDismissCooldown(),
      })
    }
    sync()
    return subscribePwaInstall(sync)
  }, [])

  const install = useCallback((): Promise<PromptOutcome> => triggerInstallPrompt(), [])

  const dismiss = useCallback(() => {
    dismissForCooldown()
    setState((prev) => (prev.coolingDown ? prev : { ...prev, coolingDown: true }))
  }, [])

  return { ...state, install, dismiss }
}
