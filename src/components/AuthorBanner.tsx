/**
 * 作者模式横幅（规格 §6）。
 *
 * 仅有效源为作者时显示：说明正在查看作者发布的只读数据，
 * 引导访客切到「我的数据」导入自己的 FIT 文件。
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
        正在查看作者{authorName === null ? '' : ` ${authorName} `}
        发布的骑行数据（只读）。切换到「我的数据」可导入你自己的 FIT 文件。
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
