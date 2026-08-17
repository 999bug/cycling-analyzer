/**
 * 骑行记录列表页（Phase 5，规格 §14）。
 * 数据来自活动仓库的分页查询，支持排序、搜索、月份/类型/数值（距离/爬升/功率）筛选与分页浏览；
 * 行点击跳转详情页。repository 支持测试注入（缺省使用全局数据库实例）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ActivityFilters from '@/features/activity/ActivityFilters'
import ActivityListTable, { type SortField, type SortOrder } from '@/features/activity/ActivityListTable'
import ActivityPagination from '@/features/activity/ActivityPagination'
import '@/features/activity/activity-page.css'
import { useUnits } from '@/hooks/useUnits'
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivityRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'

/** 每页条数（规格 §14 分页） */
const PAGE_SIZE = 20

/**
 * 列表查询参数（驱动数据加载 effect）。
 * 数值筛选字段与仓库 options 同名字段（单位：距离米、爬升米、功率 W），
 * undefined = 不限制；因此 query 可直接展开传给 listActivities。
 */
interface QueryState {
  sortBy: SortField
  sortOrder: SortOrder
  month: string
  activityType: string
  search: string
  /** 最小距离（米，undefined = 不限制） */
  minDistance?: number
  /** 最小累计爬升（米，undefined = 不限制） */
  minElevationGain?: number
  /** 最小平均功率（W，undefined = 不限制） */
  minAvgPower?: number
  offset: number
}

const DEFAULT_QUERY: QueryState = {
  sortBy: 'startTime',
  sortOrder: 'desc',
  month: '',
  activityType: '',
  search: '',
  offset: 0,
}

/**
 * 解析数值筛选输入：空字符串 = 无限制（返回 undefined）；非数字或负数 = 无效（返回 undefined）。
 * 调用方通过 raw.trim() 是否为空区分"无限制"与"无效"两种情况。
 *
 * @param raw 输入框原始字符串
 * @returns 有效数值，空或非法输入返回 undefined
 */
function parseNumericFilter(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return undefined
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) {
    return undefined
  }
  return value
}

interface ActivitiesPageProps {
  /** 活动仓库（测试注入用；缺省使用全局数据库） */
  repository?: ActivityRepository
}

/**
 * 骑行记录列表页。
 */
function ActivitiesPage({ repository }: ActivitiesPageProps) {
  const navigate = useNavigate()
  const repo = useMemo(() => repository ?? new DexieActivityRepository(db), [repository])

  const [query, setQuery] = useState<QueryState>(DEFAULT_QUERY)
  const [result, setResult] = useState<{ items: ActivitySummary[]; total: number }>({
    items: [],
    total: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [settledQuery, setSettledQuery] = useState<QueryState | null>(null)
  const [months, setMonths] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  // 距离显示单位（规格 §27）
  const { distance: distanceUnit } = useUnits()

  // 挂载时从全量数据生成月份/类型筛选选项
  useEffect(() => {
    let cancelled = false
    repo
      .listActivities({ limit: 0, sortBy: 'startTime', sortOrder: 'desc' })
      .then((result) => {
        if (cancelled) {
          return
        }
        const monthSet = new Set<string>()
        const typeSet = new Set<string>()
        for (const item of result.items) {
          monthSet.add(item.startTime.slice(0, 7))
          typeSet.add(item.activityType)
        }
        setMonths([...monthSet])
        setTypes([...typeSet])
      })
      .catch(() => {
        // 选项加载失败不阻塞列表展示
      })
    return () => {
      cancelled = true
    }
  }, [repo])

  // 查询参数变化时重新加载列表（排序/筛选/翻页均通过 setQuery 触发）
  useEffect(() => {
    let cancelled = false
    repo
      .listActivities({ ...query, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) {
          return
        }
        setResult({ items: res.items, total: res.total })
        setError(null)
        setSettledQuery(query)
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return
        }
        setResult({ items: [], total: 0 })
        setError(err instanceof Error ? err.message : '加载失败')
        setSettledQuery(query)
      })
    return () => {
      cancelled = true
    }
  }, [query, repo, reloadKey])

  // 查询进行中：最近一次完成的结果对应的查询参数不是当前查询
  const loading = error === null && settledQuery !== query

  // 表头排序：点击新列按降序，点击当前列切换方向，同时回到第一页
  function handleSortChange(field: SortField) {
    setQuery((prev) => ({
      ...prev,
      sortBy: field,
      sortOrder: prev.sortBy === field ? (prev.sortOrder === 'asc' ? 'desc' : 'asc') : 'desc',
      offset: 0,
    }))
  }

  // 筛选/搜索变更时回到第一页
  function handleMonthChange(month: string) {
    setQuery((prev) => ({ ...prev, month, offset: 0 }))
  }

  function handleTypeChange(activityType: string) {
    setQuery((prev) => ({ ...prev, activityType, offset: 0 }))
  }

  function handleSearchChange(search: string) {
    setQuery((prev) => ({ ...prev, search, offset: 0 }))
  }

  // 数值筛选变更：解析输入（空 = 不限制，非法 = 忽略本次变更），回到第一页
  function handleNumericChange(
    field: 'minDistance' | 'minElevationGain' | 'minAvgPower',
    toQuery: (value: number) => number,
  ) {
    return (raw: string) => {
      const value = parseNumericFilter(raw)
      if (value === undefined && raw.trim() !== '') {
        return
      }
      setQuery((prev) => ({
        ...prev,
        [field]: value === undefined ? undefined : toQuery(value),
        offset: 0,
      }))
    }
  }

  function handlePrevPage() {
    setQuery((prev) => ({ ...prev, offset: Math.max(0, prev.offset - PAGE_SIZE) }))
  }

  function handleNextPage() {
    setQuery((prev) => ({ ...prev, offset: prev.offset + PAGE_SIZE }))
  }

  function handleRowClick(id: string) {
    navigate(`/activities/${id}`)
  }

  const page = Math.floor(query.offset / PAGE_SIZE) + 1
  const totalPages = Math.ceil(result.total / PAGE_SIZE)
  const hasFilter =
    query.search !== '' ||
    query.month !== '' ||
    query.activityType !== '' ||
    query.minDistance !== undefined ||
    query.minElevationGain !== undefined ||
    query.minAvgPower !== undefined

  return (
    <div className="activity-page">
      <h1>骑行记录</h1>
      <ActivityFilters
        months={months}
        types={types}
        month={query.month}
        activityType={query.activityType}
        search={query.search}
        minDistanceKm={query.minDistance === undefined ? '' : String(query.minDistance / 1000)}
        minElevationGain={query.minElevationGain === undefined ? '' : String(query.minElevationGain)}
        minAvgPower={query.minAvgPower === undefined ? '' : String(query.minAvgPower)}
        onMonthChange={handleMonthChange}
        onTypeChange={handleTypeChange}
        onSearchChange={handleSearchChange}
        onMinDistanceChange={handleNumericChange('minDistance', (km) => Math.round(km * 1000))}
        onMinElevationGainChange={handleNumericChange('minElevationGain', (m) => m)}
        onMinAvgPowerChange={handleNumericChange('minAvgPower', (w) => w)}
      />
      {error ? (
        <div className="activity-page__error">
          <p>{error}</p>
          <button type="button" className="activity-page__retry" onClick={() => setReloadKey((k) => k + 1)}>
            重试
          </button>
        </div>
      ) : loading && result.items.length === 0 ? (
        <p className="activity-page__loading">加载中…</p>
      ) : result.items.length === 0 ? (
        <p className="activity-page__empty">
          {hasFilter ? '没有符合筛选条件的记录' : '还没有骑行记录，点击左侧同步骑行数据'}
        </p>
      ) : (
        <>
          <ActivityListTable
            items={result.items}
            sortBy={query.sortBy}
            sortOrder={query.sortOrder}
            onSortChange={handleSortChange}
            onRowClick={handleRowClick}
            distanceUnit={distanceUnit}
          />
          {totalPages > 1 && (
            <ActivityPagination
              page={page}
              totalPages={totalPages}
              disabled={loading}
              onPrev={handlePrevPage}
              onNext={handleNextPage}
            />
          )}
        </>
      )}
    </div>
  )
}

export default ActivitiesPage
