/**
 * 骑行记录列表页（Phase 5，规格 §14）。
 * 数据来自活动仓库的分页查询，支持排序、搜索、月份/类型/数值（距离/爬升/功率）筛选与分页浏览；
 * 行点击跳转详情页。repository 支持测试注入（缺省使用当前数据源仓库）。
 *
 * 筛选条件存于 activityFilterStore（zustand persist）：切页/刷新不丢，
 * 仅点击「重置」按钮恢复默认；排序与翻页仍为页面局部状态。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ActivityFilters from '@/features/activity/ActivityFilters'
import ActivityListTable, { type SortField, type SortOrder } from '@/features/activity/ActivityListTable'
import ActivityPagination from '@/features/activity/ActivityPagination'
import BatchRenameDialog from '@/features/activity/BatchRenameDialog'
import '@/features/activity/activity-page.css'
import { useUnits } from '@/hooks/useUnits'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { useActivityFilterStore } from '@/stores/activityFilterStore'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import {
  type ActivityReadRepository,
  type ActivityRepository,
  type ActivitySummary,
  type ActivityListOptions,
} from '@/storage/repositories/activityRepository'

/** 每页条数（规格 §14 分页） */
const PAGE_SIZE = 20

/**
 * 列表分页/排序参数（筛选条件在 activityFilterStore）。
 */
interface QueryState {
  sortBy: SortField
  sortOrder: SortOrder
  offset: number
}

const DEFAULT_QUERY: QueryState = {
  sortBy: 'startTime',
  sortOrder: 'desc',
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
  /** 活动仓库（测试注入用；缺省经门面按当前数据源分发） */
  repository?: ActivityReadRepository

  /** 本地写仓库（批量重命名测试注入；缺省弹窗内部直连 Dexie） */
  writeRepository?: Pick<ActivityRepository, 'updateName'>
}

/**
 * 骑行记录列表页。
 */
function ActivitiesPage({ repository, writeRepository }: ActivitiesPageProps) {
  const navigate = useNavigate()
  // 缺省使用当前数据源的仓库（源切换 → 实例变化 → 重新加载）；测试可注入
  const sourceRepository = useActivityRepository()
  const repo = repository ?? sourceRepository

  // 筛选条件：持久化 store（切页/刷新不丢，仅重置按钮清空）
  const filters = useActivityFilterStore()
  // 有效数据源：作者快照只读，批量重命名入口按源禁用
  const effectiveSource = useDataSourceStore(selectEffectiveSource)

  const [query, setQuery] = useState<QueryState>(DEFAULT_QUERY)
  const [result, setResult] = useState<{ items: ActivitySummary[]; total: number }>({
    items: [],
    total: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [settledQuery, setSettledQuery] = useState<object | null>(null)
  const [months, setMonths] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  // 批量重命名弹窗：候选为当前筛选命中的全部记录（非仅当前页）
  const [renameItems, setRenameItems] = useState<ActivitySummary[] | null>(null)
  // 距离显示单位（规格 §27）
  const { distance: distanceUnit } = useUnits()

  // 筛选条件 → 仓库查询参数（数值：空/非法 = 不限制；单位换算 km → 米）
  const filterOptions = useMemo<ActivityListOptions>(() => {
    const minDistanceKm = parseNumericFilter(filters.minDistanceKm)
    const minElevationGain = parseNumericFilter(filters.minElevationGain)
    const minAvgPower = parseNumericFilter(filters.minAvgPower)
    return {
      search: filters.search || undefined,
      month: filters.month || undefined,
      activityType: filters.activityType || undefined,
      minDistance: minDistanceKm === undefined ? undefined : Math.round(minDistanceKm * 1000),
      minElevationGain,
      minAvgPower,
    }
  }, [filters.search, filters.month, filters.activityType, filters.minDistanceKm, filters.minElevationGain, filters.minAvgPower])

  const listQuery = useMemo(() => ({ ...query, ...filterOptions }), [query, filterOptions])

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

  // 查询参数变化时重新加载列表（排序/筛选/翻页均触发）
  useEffect(() => {
    let cancelled = false
    repo
      .listActivities({ ...listQuery, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) {
          return
        }
        setResult({ items: res.items, total: res.total })
        setError(null)
        setSettledQuery(listQuery)
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return
        }
        setResult({ items: [], total: 0 })
        setError(err instanceof Error ? err.message : '加载失败')
        setSettledQuery(listQuery)
      })
    return () => {
      cancelled = true
    }
  }, [listQuery, repo, reloadKey])

  // 查询进行中：最近一次完成的结果对应的查询参数不是当前查询
  const loading = error === null && settledQuery !== listQuery

  // 表头排序：点击新列按降序，点击当前列切换方向，同时回到第一页
  function handleSortChange(field: SortField) {
    setQuery((prev) => ({
      ...prev,
      sortBy: field,
      sortOrder: prev.sortBy === field ? (prev.sortOrder === 'asc' ? 'desc' : 'asc') : 'desc',
      offset: 0,
    }))
  }

  // 筛选变更：写入持久化 store 并回到第一页
  function handleMonthChange(month: string) {
    filters.setMonth(month)
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  function handleTypeChange(activityType: string) {
    filters.setActivityType(activityType)
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  function handleSearchChange(search: string) {
    filters.setSearch(search)
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  // 数值筛选变更：解析输入（空 = 不限制，非法 = 忽略本次变更），写入 store 并回到第一页
  function handleNumericChange(
    setter: (value: string) => void,
  ) {
    return (raw: string) => {
      const value = parseNumericFilter(raw)
      if (value === undefined && raw.trim() !== '') {
        return
      }
      setter(raw)
      setQuery((prev) => ({ ...prev, offset: 0 }))
    }
  }

  // 重置：清空全部筛选条件（仅手动触发）并回到第一页
  function handleResetFilters() {
    filters.resetFilters()
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  // 打开批量重命名：取当前筛选命中的全部记录（不分页）
  async function handleOpenBatchRename() {
    try {
      const all = await repo.listActivities({ ...filterOptions, limit: 0 })
      setRenameItems(all.items)
    } catch (err: unknown) {
      console.error('Failed to load activities for batch rename', err)
    }
  }

  function handleRenamed() {
    setRenameItems(null)
    setReloadKey((k) => k + 1)
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
    filters.search.trim() !== '' ||
    filters.month !== '' ||
    filters.activityType !== '' ||
    filters.minDistanceKm.trim() !== '' ||
    filters.minElevationGain.trim() !== '' ||
    filters.minAvgPower.trim() !== ''

  return (
    <div className="activity-page">
      <h1>骑行记录</h1>
      <ActivityFilters
        months={months}
        types={types}
        month={filters.month}
        activityType={filters.activityType}
        search={filters.search}
        minDistanceKm={filters.minDistanceKm}
        minElevationGain={filters.minElevationGain}
        minAvgPower={filters.minAvgPower}
        onMonthChange={handleMonthChange}
        onTypeChange={handleTypeChange}
        onSearchChange={handleSearchChange}
        onMinDistanceChange={handleNumericChange(filters.setMinDistanceKm)}
        onMinElevationGainChange={handleNumericChange(filters.setMinElevationGain)}
        onMinAvgPowerChange={handleNumericChange(filters.setMinAvgPower)}
        onReset={handleResetFilters}
        onOpenBatchRename={handleOpenBatchRename}
        batchRenameDisabled={effectiveSource !== 'local'}
        batchRenameDisabledReason="作者快照为只读数据，请切换到本地数据源后重命名"
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
      {renameItems !== null && (
        <BatchRenameDialog
          items={renameItems}
          writeRepository={writeRepository}
          onClose={() => setRenameItems(null)}
          onRenamed={handleRenamed}
        />
      )}
    </div>
  )
}

export default ActivitiesPage
