/**
 * PWA 新版本更新状态 hook。
 *
 * 更新主链路是导航网络优先 + SW 静默激活（见 src/sw.ts）：刷新即新版，
 * 本 hook 的 needRefresh 信号常态为 false；UpdateBanner 横幅仅作为
 * 兜底（若新版 SW 以 waiting 态存在则提示一键更新），平时不可见。
 *
 * 本 hook 的主要职责是布置检测节奏（大厂通行做法：加载时 + 周期性 +
 * 重新可见/聚焦时），让新 SW 尽早进入后台 install：
 * - 页面加载：useRegisterSW 内部注册 SW 时自动比对 sw.js
 * - 每小时：registration.update()，覆盖长挂后台不刷新的标签页
 * - visibilitychange/focus：用户切回标签页瞬间追上最新版
 */

import { useRegisterSW } from 'virtual:pwa-register/react'

/** 周期性检查更新间隔（毫秒）：1 小时 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * 新版本更新状态。
 *
 * @returns needRefresh 新版本预缓存就绪待接管；applyUpdate 立即更新（新 SW 接管后自动刷新页面）
 */
export function useSWUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // 新 SW 注册成功后布置周期性/可见性检查（registration 生命周期 = 页面生命周期，
    // 回调仅触发一次，监听无需清理，页面卸载由浏览器统一回收）
    onRegisteredSW(_swUrl, registration) {
      if (!registration) {
        return
      }
      window.setInterval(() => {
        void registration.update()
      }, UPDATE_CHECK_INTERVAL_MS)
      const checkWhenVisible = () => {
        if (document.visibilityState === 'visible') {
          void registration.update()
        }
      }
      document.addEventListener('visibilitychange', checkWhenVisible)
      window.addEventListener('focus', checkWhenVisible)
    },
  })

  return {
    /** 新版本已就绪，等待用户确认更新 */
    needRefresh,
    /** 应用更新：向 waiting SW 发送 SKIP_WAITING，接管完成后自动刷新页面 */
    applyUpdate: () => updateServiceWorker(true),
  }
}
