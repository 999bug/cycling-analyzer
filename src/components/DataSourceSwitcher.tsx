/**
 * 数据源切换器（规格见 docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md §6）。
 *
 * 分段控件两档：作者数据（只读快照，带「作者」徽章）/ 我的数据（本地 IndexedDB）。
 * 作者名来自 store authorName（探测失败回退「作者」）。
 * 作者档不可用时（快照未发布，或可见性策略判定作者数据隐藏）整个切换器
 * 不渲染——只剩一档的分段控件是纯噪音，侧边栏直接空出来。
 */
import {
  selectAuthorVisible,
  useDataSourceStore,
} from '@/stores/dataSourceStore'
import '@/components/DataSourceSwitcher.css'

/**
 * 数据源切换器。
 */
function DataSourceSwitcher() {
  const source = useDataSourceStore((s) => s.source)
  const authorName = useDataSourceStore((s) => s.authorName)
  const setSource = useDataSourceStore((s) => s.setSource)
  const authorVisible = useDataSourceStore(
    (s) => s.authorAvailable && selectAuthorVisible(s),
  )
  const authorLabel = authorName === null ? '作者的数据' : `${authorName} 的数据`

  if (!authorVisible) {
    return null
  }

  return (
    <div className="data-source-switcher" role="group" aria-label="数据源">
      <button
        type="button"
        className={
          source === 'author'
            ? 'data-source-switcher__button data-source-switcher__button--active'
            : 'data-source-switcher__button'
        }
        aria-pressed={source === 'author'}
        onClick={() => setSource('author')}
      >
        {authorLabel}
        <span className="data-source-switcher__badge">作者</span>
      </button>
      <button
        type="button"
        className={
          source === 'local'
            ? 'data-source-switcher__button data-source-switcher__button--active'
            : 'data-source-switcher__button'
        }
        aria-pressed={source === 'local'}
        onClick={() => setSource('local')}
      >
        我的数据
      </button>
    </div>
  )
}

export default DataSourceSwitcher
