/**
 * 设置页「安装应用」区块：展示当前环境的 PWA 安装状态与入口。
 *
 * - 已安装（standalone 运行）：仅状态说明；
 * - 可一键安装（捕获到 beforeinstallprompt）：安装按钮触发原生弹窗；
 * - iOS Safari：固定展示手动步骤；
 * - 不支持：说明可用的替代浏览器。
 * 与全局横幅共用 usePwaInstall 模块级状态，安装成功两处同步消失。
 */
import { useState } from 'react'
import { usePwaInstall } from '@/features/pwa/usePwaInstall'

function InstallSection() {
  const { support, platform, install } = usePwaInstall()
  // 原生弹窗等待中禁用按钮，防重复触发
  const [prompting, setPrompting] = useState(false)

  // 一键安装可用（Chromium 系）；iOS 手动步骤；其余只读状态
  const canPrompt = support === 'prompt'
  const placeLabel = platform === 'android' ? '主屏幕' : '桌面'

  const handleInstall = async () => {
    setPrompting(true)
    try {
      await install()
    } finally {
      setPrompting(false)
    }
  }

  return (
    <section className="settings-section" aria-label="安装应用">
      <h2 className="settings-section__title">安装应用</h2>
      {support === 'installed' ? (
        <p className="settings-section__hint" data-testid="install-status">
          已安装——当前正以独立应用窗口运行，可离线使用。
        </p>
      ) : canPrompt ? (
        <>
          <p className="settings-section__hint">
            把骑了么添加到{placeLabel}，像原生应用一样独立窗口运行，离线也能查看已加载数据。
          </p>
          <button
            type="button"
            className="settings-button settings-button--primary"
            onClick={handleInstall}
            disabled={prompting}
          >
            {prompting ? '等待确认…' : `安装到${placeLabel}`}
          </button>
        </>
      ) : support === 'instructions' ? (
        <>
          <p className="settings-section__hint">按以下步骤把骑了么添加到主屏幕：</p>
          <ol className="settings-install__steps">
            <li>在 iPhone / iPad 的 Safari 浏览器中打开本站</li>
            <li>点击底部工具栏的「分享」按钮</li>
            <li>在菜单中选择「添加到主屏幕」，确认「添加」</li>
          </ol>
        </>
      ) : (
        <p className="settings-section__hint" data-testid="install-status">
          当前浏览器不支持安装应用。可使用 Chrome / Edge 访问，或改用 iPhone / iPad 的 Safari。
        </p>
      )}
    </section>
  )
}

export default InstallSection
