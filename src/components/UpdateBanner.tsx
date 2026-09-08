/**
 * 新版本更新提示条（全局唯一实例，挂 AppLayout 布局根）。
 *
 * 常态不可见：更新主链路是导航网络优先 + SW 静默激活（见 src/sw.ts），
 * 刷新一次即为新版。本组件仅作兜底——若新版 SW 仍以 waiting 态存在
 * （如静默激活链路被浏览器策略打断），则弹出品牌色横幅引导一键更新。
 */
import { useState } from 'react'
import { useSWUpdate } from '@/features/pwa/useSWUpdate'
import './UpdateBanner.css'

/** 更新请求进行中文案 */
const UPDATING_LABEL = '更新中…'

function UpdateBanner() {
  const { needRefresh, applyUpdate } = useSWUpdate()
  // 「稍后」本次会话隐藏；更新请求已发出时禁用按钮防重复点击
  const [dismissed, setDismissed] = useState(false)
  const [updating, setUpdating] = useState(false)

  if (!needRefresh || dismissed) {
    return null
  }

  const handleApply = () => {
    setUpdating(true)
    // 新 SW 接管（SKIP_WAITING → controllerchange）后由插件自动刷新页面
    applyUpdate()
  }

  return (
    <aside className="update-banner" role="alert" aria-label="新版本已就绪">
      <svg
        className="update-banner__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* 下载箭头 + 底部托盘：表达「新版本已就绪，一点即得」 */}
        <path d="M12 3v12" />
        <path d="m6 9 6 6 6-6" />
        <path d="M4 19h16" />
      </svg>
      <div className="update-banner__body">
        <p className="update-banner__title">新版本已就绪</p>
        <p className="update-banner__desc">点击「立即更新」刷新到最新版，只需一次</p>
      </div>
      <div className="update-banner__actions">
        <button
          type="button"
          className="update-banner__apply"
          onClick={handleApply}
          disabled={updating}
        >
          {updating ? UPDATING_LABEL : '立即更新'}
        </button>
        <button
          type="button"
          className="update-banner__dismiss"
          onClick={() => setDismissed(true)}
          disabled={updating}
        >
          稍后
        </button>
      </div>
    </aside>
  )
}

export default UpdateBanner
