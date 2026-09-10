/**
 * 骑行记录筛选工具栏（第一行，2026-09 改版）。
 *
 * 布局（左 → 右）：年份下拉、月份下拉、运动类型下拉、搜索框，
 * 自定义筛选组（预设下拉 + 弹窗入口按钮 + 已生效条件 chips，与搜索框同一行），
 * 右侧操作组：重置、轨迹纠偏、批量重命名、批量修正运动类型。
 *
 * 2026-09 二次优化（用户评审原型后实施）：
 * - 预设下拉：自定义筛选按钮左侧新增，选中预设即套用其条件（需求 4）
 * - 自定义筛选组与搜索输入框保持同一行（需求 5）
 * - 按钮语义色：自定义筛选/预设下拉 = info 蓝，轨迹纠偏 = warning 橙，
 *   重置 = 中性灰，批量重命名 = 品牌绿实底（需求 6）
 *
 * 2026-09 运动类型筛选回归（此前因「仅支持骑行」移除）：导入的 Strava /
 * 佳明批量导出包常同时含跑步、散步，需要能筛出来查看与修正；
 * 骑行语义页面（统计/仪表盘等）的类型隔离由 cyclingScope 负责，与本筛选无关。
 *
 * 距离/爬升/功率数值筛选移除，数值条件统一走「自定义筛选」弹窗
 * （chips 展示已生效条件，由父组件传入）。
 */
import type { ReactNode } from 'react'
import { ACTIVITY_TYPE_OPTIONS } from '@/types/activityType'

interface ActivityFiltersProps {
  /** 可用年份列表（'2026'） */
  years: string[]

  /** 可用月份列表（'2026-08'，已按所选年份过滤） */
  months: string[]

  /** 当前选中的年份（空 = 全部年份） */
  year: string

  /** 当前选中的月份（空 = 全部月份） */
  month: string

  /** 当前选中的运动类型（规范类型值，空 = 全部类型） */
  activityType: string

  /** 当前搜索关键词 */
  search: string

  onYearChange: (year: string) => void
  onMonthChange: (month: string) => void
  onActivityTypeChange: (activityType: string) => void
  onSearchChange: (search: string) => void

  /** 已保存筛选预设名列表（预设下拉选项） */
  presetNames: string[]

  /** 预设下拉选中：套用该预设条件到当前筛选 */
  onApplyPreset: (name: string) => void

  /** 自定义筛选条件 chips（展示在自定义筛选组内；缺省不渲染） */
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

  /** 打开批量修正运动类型弹窗 */
  onOpenBatchType: () => void

  /** 检测到的类型可疑活动数（0 = 无候选，按钮保持可用以便用户自行查看） */
  batchTypeSuspectCount: number

  /** 批量修正入口是否禁用（作者快照源只读） */
  batchTypeDisabled?: boolean

  /** 禁用原因提示（tooltip） */
  batchTypeDisabledReason?: string
}

/**
 * 骑行记录筛选工具栏。
 */
function ActivityFilters({
  years,
  months,
  year,
  month,
  activityType,
  search,
  onYearChange,
  onMonthChange,
  onActivityTypeChange,
  onSearchChange,
  presetNames,
  onApplyPreset,
  chips,
  onOpenCustomFilter,
  onReset,
  onOpenBatchFix,
  batchFixDisabled = false,
  batchFixDisabledReason,
  onOpenBatchRename,
  batchRenameDisabled = false,
  batchRenameDisabledReason,
  onOpenBatchType,
  batchTypeSuspectCount,
  batchTypeDisabled = false,
  batchTypeDisabledReason,
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
      <label className="activity-filters__item" htmlFor="activity-filter-type">
        类型
        <select
          id="activity-filter-type"
          className="activity-filters__select"
          value={activityType}
          onChange={(event) => onActivityTypeChange(event.target.value)}
        >
          <option value="">全部类型</option>
          {ACTIVITY_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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
      {/* 自定义筛选组：预设下拉 + 弹窗入口 + 条件 chips，与搜索输入框同一行 */}
      <div className="activity-filters__custom-group">
        <span className="activity-filters__custom-label">自定义筛选</span>
        <div className="activity-filters__custom-row">
          <select
            aria-label="选择预设"
            className="activity-filters__preset"
            value=""
            disabled={presetNames.length === 0}
            onChange={(event) => {
              const name = event.target.value
              if (name !== '') {
                onApplyPreset(name)
              }
            }}
          >
            <option value="">{presetNames.length === 0 ? '暂无预设' : '选择预设…'}</option>
            {presetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button type="button" className="activity-filters__custom" onClick={onOpenCustomFilter}>
            自定义筛选
          </button>
          {chips !== undefined && <div className="activity-filters__chips">{chips}</div>}
        </div>
      </div>
      {/* 右侧操作组（从左到右：重置 / 轨迹纠偏 / 批量重命名 / 批量修正运动类型） */}
      <div className="activity-filters__actions">
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
        {/* 检出可疑类型时按钮加数字，帮助用户发现「跑步被标成骑行」这类问题 */}
        <button
          type="button"
          className={
            batchTypeSuspectCount > 0
              ? 'activity-filters__type-fix activity-filters__type-fix--alert'
              : 'activity-filters__type-fix'
          }
          disabled={batchTypeDisabled}
          title={batchTypeDisabled ? batchTypeDisabledReason : undefined}
          onClick={onOpenBatchType}
        >
          批量修正运动类型{batchTypeSuspectCount > 0 ? `（${batchTypeSuspectCount}）` : ''}
        </button>
      </div>
    </div>
  )
}

export default ActivityFilters
