/**
 * 骑行记录分页条（2026-09 改版）：总条数 + 每页大小下拉（最大 500）
 * + 页码按钮（含省略号）+ 上一页/下一页（规格 §14 分页）。
 */
import { PAGE_SIZE_OPTIONS } from '@/stores/activityFilterStore'

interface ActivityPaginationProps {
  /** 当前页码（从 1 开始） */
  page: number

  /** 总页数 */
  totalPages: number

  /** 满足筛选条件的总条数 */
  total: number

  /** 当前每页条数 */
  pageSize: number

  /** 数据加载中（禁用翻页） */
  disabled: boolean

  /** 切换页码（从 1 开始） */
  onPageChange: (page: number) => void

  /** 切换每页条数（切回第一页由父组件处理） */
  onPageSizeChange: (size: number) => void
}

/**
 * 页码序列（含省略号占位 -1）：页数少时全展示，
 * 多时展示首尾页 + 当前页前后各一页，间隔以「…」占位。
 */
function pageItems(page: number, totalPages: number): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const items = new Set<number>([1, totalPages, page])
  if (page - 1 > 1) {
    items.add(page - 1)
  }
  if (page + 1 < totalPages) {
    items.add(page + 1)
  }
  const sorted = [...items].sort((a, b) => a - b)
  const result: number[] = []
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      result.push(-1)
    }
    result.push(sorted[i])
  }
  return result
}

/**
 * 骑行记录分页条。
 */
function ActivityPagination({
  page,
  totalPages,
  total,
  pageSize,
  disabled,
  onPageChange,
  onPageSizeChange,
}: ActivityPaginationProps) {
  return (
    <div className="activity-pagination">
      <span className="activity-pagination__info">共 {total} 条</span>
      <select
        aria-label="每页条数"
        className="activity-pagination__size"
        value={pageSize}
        disabled={disabled}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
      >
        {PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size}条/页
          </option>
        ))}
      </select>
      <button
        type="button"
        className="activity-pagination__button"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 1}
      >
        上一页
      </button>
      {pageItems(page, totalPages).map((item, index) =>
        item === -1 ? (
          <span key={`ellipsis-${index}`} className="activity-pagination__ellipsis">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={
              item === page
                ? 'activity-pagination__page activity-pagination__page--active'
                : 'activity-pagination__page'
            }
            aria-label={`第 ${item} 页`}
            aria-current={item === page ? 'page' : undefined}
            disabled={disabled}
            onClick={() => onPageChange(item)}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        className="activity-pagination__button"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || page >= totalPages}
      >
        下一页
      </button>
    </div>
  )
}

export default ActivityPagination
