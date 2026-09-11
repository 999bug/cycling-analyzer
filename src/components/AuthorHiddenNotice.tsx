/**
 * 「作者数据已隐藏」一次性提示条。
 *
 * auto 可见性策略下本地数据从无到有时出现（老用户升级迁移或首次导入）：
 * 告知当前只显示自己的数据、作者数据可在「更多」页重新打开。
 * 「去更多」直达 /settings#author-data 并高亮该区块；关闭后标记清除不再出现。
 */
import { useNavigate } from 'react-router-dom'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import '@/components/AuthorHiddenNotice.css'

/**
 * 作者数据已隐藏提示条。
 */
function AuthorHiddenNotice() {
  const pending = useDataSourceStore((s) => s.authorHiddenNoticePending)
  const dismiss = useDataSourceStore((s) => s.dismissAuthorHiddenNotice)
  const navigate = useNavigate()

  if (!pending) {
    return null
  }

  return (
    <div className="author-hidden-notice" role="status">
      <p className="author-hidden-notice__text">
        已切换到你的数据——作者的示例数据已默认隐藏，需要对比时可在「更多」里重新打开。
      </p>
      <button
        type="button"
        className="author-hidden-notice__action"
        onClick={() => {
          dismiss()
          navigate('/settings#author-data')
        }}
      >
        去更多
      </button>
      <button
        type="button"
        aria-label="关闭提示"
        className="author-hidden-notice__close"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  )
}

export default AuthorHiddenNotice
