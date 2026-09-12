/**
 * 示例数据说明条（规格 §6）。
 *
 * 仅有效源为作者时显示：说明当前看到的是站点内置的示例数据（不强调作者身份），
 * 导入自己的 FIT 文件后自动换成用户的数据；条上直接提供导入入口，
 * 免去新用户在界面里找「同步骑行数据」的成本。
 *
 * 关闭状态持久化在 dataSourceStore（设置页「作者数据」区块可重新显示），
 * 不再使用独立的 localStorage key。
 */
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { useImportStore } from '@/stores/importStore'
import '@/components/AuthorBanner.css'

/**
 * 示例数据说明条。
 */
function AuthorBanner() {
  const source = useDataSourceStore(selectEffectiveSource)
  const dismissed = useDataSourceStore((s) => s.authorBannerDismissed)
  const dismiss = useDataSourceStore((s) => s.dismissAuthorBanner)
  const openImportDialog = useImportStore((s) => s.openImportDialog)

  if (source !== 'author' || dismissed) {
    return null
  }

  return (
    <div className="author-banner" role="status">
      <div className="author-banner__body">
        <p className="author-banner__headline">
          <span className="author-banner__badge">示例数据</span>
          你现在看到的不是自己的骑行记录，而是站点内置的示例数据
        </p>
        <p className="author-banner__hint">
          导入你的 FIT 文件后，这里会立刻换成你自己的数据 · 文件只在本机解析，不会上传
        </p>
      </div>
      <div className="author-banner__actions">
        <button
          type="button"
          className="author-banner__import"
          onClick={openImportDialog}
        >
          导入我的数据
        </button>
        <button
          type="button"
          aria-label="关闭提示"
          className="author-banner__close"
          onClick={dismiss}
        >
          ×
        </button>
      </div>
    </div>
  )
}

export default AuthorBanner
