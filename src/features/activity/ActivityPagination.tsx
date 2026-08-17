/**
 * 骑行记录分页条：上一页/下一页 + 页码指示（规格 §14 分页）。
 */
interface ActivityPaginationProps {
  /** 当前页码（从 1 开始） */
  page: number

  /** 总页数 */
  totalPages: number

  /** 数据加载中（禁用翻页按钮） */
  disabled: boolean

  onPrev: () => void
  onNext: () => void
}

/**
 * 骑行记录分页条。
 */
function ActivityPagination({ page, totalPages, disabled, onPrev, onNext }: ActivityPaginationProps) {
  return (
    <div className="activity-pagination">
      <button type="button" className="activity-pagination__button" onClick={onPrev} disabled={disabled || page <= 1}>
        上一页
      </button>
      <span className="activity-pagination__info">
        第 {page} / {totalPages} 页
      </span>
      <button
        type="button"
        className="activity-pagination__button"
        onClick={onNext}
        disabled={disabled || page >= totalPages}
      >
        下一页
      </button>
    </div>
  )
}

export default ActivityPagination
