/**
 * 作者模式横幅（规格 §6；可见性改造后定位为「示例模式」说明条）。
 *
 * 仅有效源为作者时显示：说明当前是作者的公开数据示例，
 * 导入自己的 FIT 文件后站点会自动换成用户的数据。
 * 可关闭，localStorage 记忆（key：author-banner-dismissed）。
 */
import { useState } from 'react'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import '@/components/AuthorBanner.css'

/** 关闭记忆的 localStorage key */
const DISMISS_KEY = 'author-banner-dismissed'

/**
 * 作者模式横幅。
 */
function AuthorBanner() {
  const source = useDataSourceStore(selectEffectiveSource)
  const authorName = useDataSourceStore((s) => s.authorName)
  // 关闭记忆：挂载时读一次 localStorage
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (source !== 'author' || dismissed) {
    return null
  }

  return (
    <div className="author-banner" role="status">
      <p className="author-banner__text">
        你现在看到的是作者{authorName === null ? '' : ` ${authorName} `}
        的公开骑行数据，用来演示这个站点能做什么。
        导入你自己的 FIT 文件后，这里会自动换成你的数据——
        你的数据只保存在这台设备的浏览器里，不会上传。
      </p>
      <button
        type="button"
        aria-label="关闭提示"
        className="author-banner__close"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1')
          setDismissed(true)
        }}
      >
        ×
      </button>
    </div>
  )
}

export default AuthorBanner
