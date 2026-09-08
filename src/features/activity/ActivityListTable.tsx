/**
 * 骑行记录表格（列表页主体，规格 §14 表格列）。
 * 负责列定义、排序表头与行渲染；数据与交互回调由父组件注入。
 * 整行可点击（鼠标）且可聚焦（键盘 Enter/Space），标题列额外渲染为
 * 真实链接（a11y：屏幕阅读器/键盘 Tab 有明确的详情入口）。
 *
 * 扩展（2026-09，用户评审原型后立项）：
 * - 全部 8 列可排序（含标题/爬升/平均速度/平均心率/平均功率），排序状态由父组件持久化
 * - 可选勾选列（selectable = true 时渲染，作者快照只读源由父组件隐藏）：
 *   表头全选当前页行，勾选不触发行点击跳转
 */
import { Link } from 'react-router-dom'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { formatDate, formatDuration, formatElevation } from '@/utils/format'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'

/** 可排序字段（与仓库 listActivities 的 sortBy 一致，覆盖全部 8 列） */
export type SortField =
  | 'name'
  | 'startTime'
  | 'distance'
  | 'duration'
  | 'elevationGain'
  | 'avgSpeed'
  | 'avgHeartRate'
  | 'avgPower'

/** 排序方向 */
export type SortOrder = 'asc' | 'desc'

interface ActivityListTableProps {
  /** 当前页活动摘要 */
  items: ActivitySummary[]

  /** 当前排序字段 */
  sortBy: SortField

  /** 当前排序方向 */
  sortOrder: SortOrder

  /** 表头排序回调（传入被点击的字段） */
  onSortChange: (field: SortField) => void

  /** 行点击回调（传入活动 ID，跳转详情页） */
  onRowClick: (id: string) => void

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit

  /** 是否渲染勾选列（本地数据源批量删除用；缺省不渲染） */
  selectable?: boolean

  /** 已勾选活动 ID 集合（selectable 时必传） */
  selectedIds?: ReadonlySet<string>

  /** 单行勾选切换回调（勾选框点击不触发行跳转） */
  onToggleSelect?: (id: string, checked: boolean) => void

  /** 表头全选/取消全选当前页行回调 */
  onToggleSelectAll?: (checked: boolean) => void
}

/** 列定义：标题、可排序字段、对齐方式与单元格渲染 */
interface Column {
  key: string
  label: string
  /** 可排序字段（缺省 = 不可排序列） */
  sortBy?: SortField
  align: 'left' | 'right'
  render: (item: ActivitySummary) => string
}

/**
 * 构建列定义（距离/速度按显示单位格式化；8 列全部可排序）。
 *
 * @param distanceUnit 距离显示单位
 * @returns 列定义列表
 */
function buildColumns(distanceUnit: DistanceUnit): Column[] {
  return [
    {
      key: 'title',
      label: '标题',
      sortBy: 'name',
      align: 'left',
      render: (item) => item.name ?? `${formatDate(item.startTime)} 骑行`,
    },
    {
      key: 'startTime',
      label: '日期',
      sortBy: 'startTime',
      align: 'left',
      render: (item) => formatDate(item.startTime),
    },
    {
      key: 'distance',
      label: '距离',
      sortBy: 'distance',
      align: 'right',
      render: (item) => formatDistanceByUnit(item.distance, distanceUnit),
    },
    {
      key: 'duration',
      label: '时长',
      sortBy: 'duration',
      align: 'right',
      render: (item) => formatDuration(item.duration),
    },
    {
      key: 'elevation',
      label: '爬升',
      sortBy: 'elevationGain',
      align: 'right',
      render: (item) => formatElevation(item.elevationGain),
    },
    {
      key: 'speed',
      label: '平均速度',
      sortBy: 'avgSpeed',
      align: 'right',
      render: (item) => formatSpeedByUnit(item.avgSpeed, distanceUnit),
    },
    {
      key: 'heartRate',
      label: '平均心率',
      sortBy: 'avgHeartRate',
      align: 'right',
      render: (item) => formatMetric(item.avgHeartRate, 'bpm'),
    },
    {
      key: 'power',
      label: '平均功率',
      sortBy: 'avgPower',
      align: 'right',
      render: (item) => formatMetric(item.avgPower, 'W'),
    },
  ]
}

/**
 * 格式化心率/功率等数值指标（无效值显示占位符）。
 *
 * @param value 数值（可为空）
 * @param unit 单位后缀
 * @returns 如 '141 bpm'，无效输入返回 '—'
 */
function formatMetric(value: number | null | undefined, unit: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} ${unit}` : '—'
}

/**
 * 骑行记录表格。
 */
function ActivityListTable({
  items,
  sortBy,
  sortOrder,
  onSortChange,
  onRowClick,
  distanceUnit = 'km',
  selectable = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: ActivityListTableProps) {
  const columns = buildColumns(distanceUnit)
  // 全选状态：当前页全部行已勾选（空列表不算全选）
  const allSelected =
    selectable === true &&
    items.length > 0 &&
    items.every((item) => selectedIds?.has(item.id) === true)

  return (
    <table className="activity-table">
      <thead>
        <tr>
          {selectable && (
            <th className="activity-table__check">
              <input
                type="checkbox"
                aria-label="全选本页"
                checked={allSelected}
                onChange={(event) => onToggleSelectAll?.(event.target.checked)}
              />
            </th>
          )}
          {columns.map((col) => {
            const sortField = col.sortBy
            return (
              <th key={col.key} className={col.align === 'right' ? 'activity-table__num' : undefined}>
                {sortField ? (
                  <button
                    type="button"
                    className={
                      sortBy === sortField
                        ? 'activity-table__sort activity-table__sort--active'
                        : 'activity-table__sort'
                    }
                    onClick={() => onSortChange(sortField)}
                  >
                    {col.label}
                    {sortBy === sortField && (
                      <span className="activity-table__arrow">{sortOrder === 'desc' ? '↓' : '↑'}</span>
                    )}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.id}
            className={
              selectedIds?.has(item.id) === true
                ? 'activity-table__row activity-table__row--selected'
                : 'activity-table__row'
            }
            tabIndex={0}
            onClick={() => onRowClick(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onRowClick(item.id)
              }
            }}
          >
            {selectable && (
              <td className="activity-table__check" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`选择 ${item.name ?? item.fileName}`}
                  checked={selectedIds?.has(item.id) === true}
                  onChange={(event) => onToggleSelect?.(item.id, event.target.checked)}
                />
              </td>
            )}
            {columns.map((col) => (
              <td key={col.key} className={col.align === 'right' ? 'activity-table__num' : undefined}>
                {col.key === 'title' ? (
                  // 标题列渲染为真实链接（a11y）；stopPropagation 避免触发行点击重复导航
                  <Link
                    className="activity-table__title-link"
                    to={`/activities/${item.id}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {col.render(item)}
                  </Link>
                ) : (
                  col.render(item)
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default ActivityListTable
