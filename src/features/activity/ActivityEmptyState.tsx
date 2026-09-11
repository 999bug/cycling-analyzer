/**
 * 骑行记录列表空态（2026-09-11 体验优化）。
 *
 * 区分两种「没有数据」：
 * 1. 库里本来就没有记录 → 引导去导入（与改造前一致）；
 * 2. 筛选条件筛没了 → 说清「当前条件下 0 条、库里共 N 条」并列出生效条件，
 *    给一个「重置筛选」按钮直接回到全部记录。
 * 第二种场景下只给一句「没有符合筛选条件的记录」时，用户不知道是哪条条件卡住、
 * 也不知道还剩多少数据可看，这里把这层信息补齐。
 */
interface ActivityEmptyStateProps {
  /** 是否因筛选条件导致为空（false = 库里本来就没数据） */
  filtered: boolean

  /** 库里记录总数（重置后可见条数；0 表示未知，用于按钮文案） */
  totalCount: number

  /** 当前生效的筛选条件描述（展示为 chips，便于定位是哪条把结果筛没了） */
  conditions: string[]

  /** 点击「重置筛选」的回调（与工具栏重置一致） */
  onReset: () => void
}

/**
 * 骑行记录列表空态。
 *
 * @param props 组件参数
 */
function ActivityEmptyState({ filtered, totalCount, conditions, onReset }: ActivityEmptyStateProps) {
  // 非筛选场景：保持原来的导入引导（无筛选可重置，给按钮反而误导）
  if (!filtered) {
    return <p className="activity-page__empty">还没有骑行记录，点击左侧同步骑行数据</p>
  }

  return (
    <div className="activity-empty" role="status">
      <div className="activity-empty__icon" aria-hidden="true" />
      <p className="activity-empty__title">没有符合当前筛选条件的记录</p>
      <p className="activity-empty__hint">
        {totalCount > 0
          ? `当前条件下共 0 条，库里有 ${totalCount} 条记录`
          : '当前条件下没有记录，换个条件或重置筛选再试试'}
      </p>
      {conditions.length > 0 && (
        <ul className="activity-empty__conditions" aria-label="当前筛选条件">
          {conditions.map((label) => (
            <li key={label} className="activity-filter-chip">
              {label}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="activity-empty__reset" onClick={onReset}>
        {totalCount > 0 ? `重置筛选，查看全部 ${totalCount} 条` : '重置筛选'}
      </button>
    </div>
  )
}

export default ActivityEmptyState
