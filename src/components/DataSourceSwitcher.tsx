/**
 * 数据源切换器（规格见 docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md §6）。
 *
 * 分段控件两档：作者数据（只读快照，带「作者」徽章）/ 我的数据（本地 IndexedDB）。
 * 作者名来自 store authorName（探测失败回退「作者」）；
 * 快照不可用时作者档禁用，访客仍可切本地。
 */
import { useDataSourceStore } from '@/stores/dataSourceStore'
import '@/components/DataSourceSwitcher.css'

/**
 * 数据源切换器。
 */
function DataSourceSwitcher() {
  const source = useDataSourceStore((s) => s.source)
  const authorAvailable = useDataSourceStore((s) => s.authorAvailable)
  const authorName = useDataSourceStore((s) => s.authorName)
  const setSource = useDataSourceStore((s) => s.setSource)
  const authorLabel = authorName === null ? '作者的数据' : `${authorName} 的数据`

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
        disabled={!authorAvailable}
        title={authorAvailable ? undefined : '作者数据暂未发布'}
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
