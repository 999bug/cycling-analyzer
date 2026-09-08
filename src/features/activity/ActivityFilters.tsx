/**
 * 骑行记录筛选栏：搜索框 + 月份下拉 + 类型下拉 + 自定义条件 chips
 * + 距离/爬升/功率数值筛选（规格 §14、§30）。
 * 月份/类型选项由父组件从全量数据生成，空值表示"全部"。
 * 数值筛选输入为空 = 不限制；校验（非负数字）由父组件完成，本组件只做输入收集。
 *
 * 扩展（2026-09）：已生效的自定义筛选条件以 chips 形式展示在「类型」下拉右侧
 * （chips 节点由父组件传入，含移除交互），与既有筛选并列。
 */
import type { ReactNode } from 'react'

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

  /** 最小距离（km，空 = 不限制，输入框显示值） */
  minDistanceKm: string

  /** 最小累计爬升（m，空 = 不限制） */
  minElevationGain: string

  /** 最小平均功率（W，空 = 不限制） */
  minAvgPower: string

  onMonthChange: (month: string) => void
  onTypeChange: (type: string) => void
  onSearchChange: (search: string) => void
  onMinDistanceChange: (km: string) => void
  onMinElevationGainChange: (m: string) => void
  onMinAvgPowerChange: (w: string) => void

  /** 自定义筛选条件 chips（展示在类型下拉右侧；缺省不渲染） */
  chips?: ReactNode

  /** 重置全部筛选条件（仅手动点击触发） */
  onReset: () => void

  /** 打开批量重命名弹窗 */
  onOpenBatchRename: () => void

  /** 批量重命名入口是否禁用（作者快照源只读） */
  batchRenameDisabled?: boolean

  /** 禁用原因提示（tooltip） */
  batchRenameDisabledReason?: string
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
  minDistanceKm,
  minElevationGain,
  minAvgPower,
  onMonthChange,
  onTypeChange,
  onSearchChange,
  onMinDistanceChange,
  onMinElevationGainChange,
  onMinAvgPowerChange,
  chips,
  onReset,
  onOpenBatchRename,
  batchRenameDisabled = false,
  batchRenameDisabledReason,
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
      {/* 自定义筛选条件 chips：紧跟类型下拉右侧，可换行延伸 */}
      {chips !== undefined && <div className="activity-filters__chips">{chips}</div>}
      <label className="activity-filters__item" htmlFor="activity-filter-min-distance">
        距离(km)
        <input
          id="activity-filter-min-distance"
          type="number"
          min={0}
          step="0.1"
          className="activity-filters__input"
          placeholder="最小距离"
          value={minDistanceKm}
          onChange={(event) => onMinDistanceChange(event.target.value)}
        />
      </label>
      <label className="activity-filters__item" htmlFor="activity-filter-min-elevation">
        爬升(m)
        <input
          id="activity-filter-min-elevation"
          type="number"
          min={0}
          className="activity-filters__input"
          placeholder="最小爬升"
          value={minElevationGain}
          onChange={(event) => onMinElevationGainChange(event.target.value)}
        />
      </label>
      <label className="activity-filters__item" htmlFor="activity-filter-min-power">
        平均功率(W)
        <input
          id="activity-filter-min-power"
          type="number"
          min={0}
          className="activity-filters__input"
          placeholder="最小功率"
          value={minAvgPower}
          onChange={(event) => onMinAvgPowerChange(event.target.value)}
        />
      </label>
      {/* 操作按钮与筛选输入同行：重置在前（弱化样式），批量重命名在后（主题色区分筛选输入） */}
      <div className="activity-filters__actions">
        <button type="button" className="activity-filters__reset" onClick={onReset}>
          重置
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
