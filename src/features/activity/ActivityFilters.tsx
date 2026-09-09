/**
 * 骑行记录筛选工具栏（第一行，2026-09 改版）。
 *
 * 布局（左 → 右）：年份下拉（第一列）、月份下拉（第二列）、搜索框，
 * 右侧操作组：自定义筛选（弹窗）、重置、轨迹纠偏、批量重命名
 * （从右到左依次为批量重命名 / 轨迹纠偏 / 重置，用户指定）。
 * 类型筛选已移除（当前仅支持骑行）；距离/爬升/功率数值筛选移除，
 * 数值条件统一走「自定义筛选」弹窗（chips 展示已生效条件，由父组件传入）。
 */
import type { ReactNode } from 'react'

interface ActivityFiltersProps {
  /** 可用年份列表（'2026'） */
  years: string[]

  /** 可用月份列表（'2026-08'，已按所选年份过滤） */
  months: string[]

  /** 当前选中的年份（空 = 全部年份） */
  year: string

  /** 当前选中的月份（空 = 全部月份） */
  month: string

  /** 当前搜索关键词 */
  search: string

  onYearChange: (year: string) => void
  onMonthChange: (month: string) => void
  onSearchChange: (search: string) => void

  /** 自定义筛选条件 chips（展示在搜索框右侧；缺省不渲染） */
  chips?: ReactNode

  /** 打开自定义筛选弹窗 */
  onOpenCustomFilter: () => void

  /** 重置全部筛选条件（仅手动点击触发） */
  onReset: () => void

  /** 打开批量轨迹纠偏弹窗（作用于当前筛选命中的全部记录） */
  onOpenBatchFix: () => void

  /** 轨迹纠偏入口是否禁用（作者快照源只读） */
  batchFixDisabled?: boolean

  /** 轨迹纠偏禁用原因提示（tooltip） */
  batchFixDisabledReason?: string

  /** 打开批量重命名弹窗 */
  onOpenBatchRename: () => void

  /** 批量重命名入口是否禁用（作者快照源只读） */
  batchRenameDisabled?: boolean

  /** 禁用原因提示（tooltip） */
  batchRenameDisabledReason?: string
}

/**
 * 骑行记录筛选工具栏。
 */
function ActivityFilters({
  years,
  months,
  year,
  month,
  search,
  onYearChange,
  onMonthChange,
  onSearchChange,
  chips,
  onOpenCustomFilter,
  onReset,
  onOpenBatchFix,
  batchFixDisabled = false,
  batchFixDisabledReason,
  onOpenBatchRename,
  batchRenameDisabled = false,
  batchRenameDisabledReason,
}: ActivityFiltersProps) {
  return (
    <div className="activity-filters">
      <label className="activity-filters__item" htmlFor="activity-filter-year">
        年份
        <select
          id="activity-filter-year"
          className="activity-filters__select"
          value={year}
          onChange={(event) => onYearChange(event.target.value)}
        >
          <option value="">全部年份</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
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
      {/* 自定义筛选条件 chips：紧跟搜索框右侧，可换行延伸 */}
      {chips !== undefined && <div className="activity-filters__chips">{chips}</div>}
      {/* 右侧操作组（从右到左：批量重命名 / 轨迹纠偏 / 重置，左侧为自定义筛选） */}
      <div className="activity-filters__actions">
        <button type="button" className="activity-filters__custom" onClick={onOpenCustomFilter}>
          自定义筛选
        </button>
        <button type="button" className="activity-filters__reset" onClick={onReset}>
          重置
        </button>
        <button
          type="button"
          className="activity-filters__fix"
          disabled={batchFixDisabled}
          title={batchFixDisabled ? batchFixDisabledReason : undefined}
          onClick={onOpenBatchFix}
        >
          轨迹纠偏
        </button>
        <button
          type="button"
          className="activity-filters__rename"
          disabled={batchRenameDisabled}
          title={batchRenameDisabled ? batchRenameDisabledReason : undefined}
          onClick={onOpenBatchRename}
        >
          批量重命名
        </button>
      </div>
    </div>
  )
}

export default ActivityFilters
