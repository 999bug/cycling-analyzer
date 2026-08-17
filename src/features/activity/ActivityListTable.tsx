/**
 * 骑行记录表格（列表页主体，规格 §14 表格列）。
 * 负责列定义、排序表头与行渲染；数据与交互回调由父组件注入。
 * 整行可点击（鼠标）且可聚焦（键盘 Enter/Space），标题列额外渲染为
 * 真实链接（a11y：屏幕阅读器/键盘 Tab 有明确的详情入口）。
 */
import { Link } from 'react-router-dom'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { formatDate, formatDuration, formatElevation } from '@/utils/format'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'

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

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
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
 * 构建列定义（距离/速度按显示单位格式化）。
 *
 * @param distanceUnit 距离显示单位
 * @returns 列定义列表
 */
function buildColumns(distanceUnit: DistanceUnit): Column[] {
  return [
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
      align: 'right',
      render: (item) => formatElevation(item.elevationGain),
    },
    {
      key: 'speed',
      label: '平均速度',
      align: 'right',
      render: (item) => formatSpeedByUnit(item.avgSpeed, distanceUnit),
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
function ActivityListTable({ items, sortBy, sortOrder, onSortChange, onRowClick, distanceUnit = 'km' }: ActivityListTableProps) {
  const columns = buildColumns(distanceUnit)
  return (
    <table className="activity-table">
      <thead>
        <tr>
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
