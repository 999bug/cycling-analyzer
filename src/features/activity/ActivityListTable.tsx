/**
 * 骑行记录表格（列表页主体，规格 §14 表格列）。
 * 负责列定义、排序表头与行渲染；数据与交互回调由父组件注入。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { formatDate, formatDistance, formatDuration, formatElevation, formatSpeed } from '@/utils/format'

/** 可排序字段（与仓库 listActivities 的 sortBy 一致） */
export type SortField = 'startTime' | 'distance' | 'duration'

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

const COLUMNS: Column[] = [
  {
    key: 'startTime',
    label: '日期',
    sortBy: 'startTime',
    align: 'left',
    render: (item) => formatDate(item.startTime),
  },
  {
    key: 'title',
    label: '标题',
    align: 'left',
    render: (item) => item.name ?? `${formatDate(item.startTime)} 骑行`,
  },
  {
    key: 'distance',
    label: '距离',
    sortBy: 'distance',
    align: 'right',
    render: (item) => formatDistance(item.distance),
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
    align: 'right',
    render: (item) => formatElevation(item.elevationGain),
  },
  {
    key: 'speed',
    label: '平均速度',
    align: 'right',
    render: (item) => formatSpeed(item.avgSpeed),
  },
  {
    key: 'heartRate',
    label: '平均心率',
    align: 'right',
    render: (item) => formatMetric(item.avgHeartRate, 'bpm'),
  },
  {
    key: 'power',
    label: '平均功率',
    align: 'right',
    render: (item) => formatMetric(item.avgPower, 'W'),
  },
]

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
function ActivityListTable({ items, sortBy, sortOrder, onSortChange, onRowClick }: ActivityListTableProps) {
  return (
    <table className="activity-table">
      <thead>
        <tr>
          {COLUMNS.map((col) => {
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
            className="activity-table__row"
            tabIndex={0}
            onClick={() => onRowClick(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onRowClick(item.id)
              }
            }}
          >
            {COLUMNS.map((col) => (
              <td key={col.key} className={col.align === 'right' ? 'activity-table__num' : undefined}>
                {col.render(item)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default ActivityListTable
