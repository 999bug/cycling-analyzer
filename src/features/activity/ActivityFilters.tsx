/**
 * 骑行记录筛选栏：搜索框 + 月份下拉 + 类型下拉（规格 §14）。
 * 月份/类型选项由父组件从全量数据生成，空值表示"全部"。
 */
interface ActivityFiltersProps {
  /** 可用月份列表（'2026-08'） */
  months: string[]

  /** 可用运动类型列表（如 cycling / running） */
  types: string[]

  /** 当前选中的月份（空 = 全部月份） */
  month: string

  /** 当前选中的类型（空 = 全部类型） */
  activityType: string

  /** 当前搜索关键词 */
  search: string

  onMonthChange: (month: string) => void
  onTypeChange: (type: string) => void
  onSearchChange: (search: string) => void
}

/**
 * 骑行记录筛选栏。
 */
function ActivityFilters({
  months,
  types,
  month,
  activityType,
  search,
  onMonthChange,
  onTypeChange,
  onSearchChange,
}: ActivityFiltersProps) {
  return (
    <div className="activity-filters">
      <label className="activity-filters__item" htmlFor="activity-filter-search">
        搜索
        <input
          id="activity-filter-search"
          type="search"
          className="activity-filters__input"
          placeholder="标题或文件名"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      <label className="activity-filters__item" htmlFor="activity-filter-month">
        月份
        <select
          id="activity-filter-month"
          className="activity-filters__select"
          value={month}
          onChange={(event) => onMonthChange(event.target.value)}
        >
          <option value="">全部月份</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="activity-filters__item" htmlFor="activity-filter-type">
        类型
        <select
          id="activity-filter-type"
          className="activity-filters__select"
          value={activityType}
          onChange={(event) => onTypeChange(event.target.value)}
        >
          <option value="">全部类型</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export default ActivityFilters
