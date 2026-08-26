/**
 * PWA 安装引导横幅（全局唯一实例，挂 AppLayout 布局根）。
 *
 * 展示条件：可安装（捕获到 beforeinstallprompt 或 iOS 手动路径）且
 * 未安装、不处于「稍后」冷却期。Chromium 系一键触发原生安装弹窗；
 * iOS Safari 直接展示「分享 → 添加到主屏幕」手动步骤。
 * 「稍后」进入 14 天冷却期；用户取消原生弹窗同样进冷却，避免反复打扰。
 */
import { useState } from 'react'
import { usePwaInstall } from '@/features/pwa/usePwaInstall'
import './InstallBanner.css'

/** 应用图标（PWA manifest 同源 192px） */
const APP_ICON_PATH = `${import.meta.env.BASE_URL}icons/icon-192.png`

function InstallBanner() {
  const { support, platform, coolingDown, install, dismiss } = usePwaInstall()
  // 原生弹窗等待中禁用按钮，防重复触发
  const [prompting, setPrompting] = useState(false)

  // 已安装 / 环境不支持 / 冷却期内：一律不展示
  if (support === 'installed' || support === 'unsupported' || coolingDown) {
    return null
  }

  // 一键安装可用（Chromium 系）；否则为 iOS 手动步骤形态
  const canPrompt = support === 'prompt'
  const placeLabel = platform === 'android' ? '主屏幕' : '桌面'

  const handleInstall = async () => {
    setPrompting(true)
    try {
      const outcome = await install()
      // 用户取消原生弹窗也视为「稍后」，进冷却期避免反复打扰
      if (outcome !== 'accepted') {
        dismiss()
      }
    } finally {
      setPrompting(false)
    }
  }

  return (
    <aside className="install-banner" role="complementary" aria-label="安装骑了么应用">
      <img className="install-banner__icon" src={APP_ICON_PATH} alt="" aria-hidden="true" />
      <div className="install-banner__body">
        <p className="install-banner__title">把骑了么安装成应用</p>
        {canPrompt ? (
          <p className="install-banner__desc">添加到{placeLabel}，离线也能查看你的骑行数据</p>
        ) : (
          <p className="install-banner__desc">在 Safari 底部点击「分享」按钮，选择「添加到主屏幕」</p>
        )}
      </div>
      <div className="install-banner__actions">
        {canPrompt && (
          <button
            type="button"
            className="install-banner__install"
            onClick={handleInstall}
            disabled={prompting}
          >
            {prompting ? '等待确认…' : '立即安装'}
          </button>
        )}
        <button type="button" className="install-banner__dismiss" onClick={dismiss}>
          {canPrompt ? '稍后' : '知道了'}
        </button>
      </div>
    </aside>
  )
}

export default InstallBanner
