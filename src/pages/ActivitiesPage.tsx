/**
 * 骑行记录列表页（Phase 5，规格 §14）。
 * 数据来自活动仓库的分页查询，支持排序、搜索、月份/类型/数值（距离/爬升/功率）筛选、
 * 自定义条件筛选（大于/等于/小于/介于 + 预设）与分页浏览；行点击跳转详情页。
 * repository 支持测试注入（缺省使用当前数据源仓库）。
 *
 * 筛选条件、排序状态、自定义条件与筛选预设均存于 activityFilterStore（zustand persist）：
 * 切页/刷新/切筛选不丢，仅手动「重置」/「重置排序」还原。
 * 勾选批量删除仅本地数据源可用（作者快照只读，勾选列隐藏）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ActivityFilters from '@/features/activity/ActivityFilters'
import ActivityListTable, { type SortField } from '@/features/activity/ActivityListTable'
import ActivityPagination from '@/features/activity/ActivityPagination'
import BatchRenameDialog from '@/features/activity/BatchRenameDialog'
import CustomFilterPanel from '@/features/activity/CustomFilterPanel'
import DeleteActivitiesDialog from '@/features/activity/DeleteActivitiesDialog'
import BatchFixDialog from '@/features/activity/BatchFixDialog'
import { conditionsToBounds, describeCondition, type CustomFilterCondition } from '@/features/activity/customFilter'
import '@/features/activity/activity-page.css'
import { useUnits } from '@/hooks/useUnits'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { useActivityFilterStore, type ActivitySortField } from '@/stores/activityFilterStore'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import {
  type ActivityReadRepository,
  type ActivityRepository,
  type ActivitySummary,
  type ActivityListOptions,
} from '@/storage/repositories/activityRepository'

/** 每页条数（规格 §14 分页） */
const PAGE_SIZE = 20

/** 排序字段显示名（排序状态条用） */
const SORT_FIELD_LABELS: Record<ActivitySortField, string> = {
  name: '标题',
  startTime: '日期',
  distance: '距离',
  duration: '时长',
  elevationGain: '爬升',
  avgSpeed: '平均速度',
  avgHeartRate: '平均心率',
  avgPower: '平均功率',
}

/**
 * 列表分页参数（筛选/排序条件在 activityFilterStore）。
 */
interface QueryState {
  offset: number
}

const DEFAULT_QUERY: QueryState = { offset: 0 }

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

/** 两个下界取更紧者（更大），undefined 视为无限制 */
function tighterMin(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

interface ActivitiesPageProps {
  /** 活动仓库（测试注入用；缺省经门面按当前数据源分发） */
  repository?: ActivityReadRepository

  /** 本地写仓库（批量重命名/批量删除/批量纠偏测试注入；缺省弹窗内部直连 Dexie） */
  writeRepository?: Pick<ActivityRepository, 'updateName' | 'deleteActivity' | 'deleteActivities' | 'updateTrackSystem'>
}

/**
 * 骑行记录列表页。
 */
function ActivitiesPage({ repository, writeRepository }: ActivitiesPageProps) {
  const navigate = useNavigate()
  // 缺省使用当前数据源的仓库（源切换 → 实例变化 → 重新加载）；测试可注入
  const sourceRepository = useActivityRepository()
  const repo = repository ?? sourceRepository

  // 筛选/排序/自定义条件/预设：持久化 store（切页/刷新不丢，仅重置按钮清空）
  const filters = useActivityFilterStore()
  // 有效数据源：作者快照只读，批量重命名禁用、勾选删除隐藏
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
  // 勾选批量删除：ID → 摘要（跨翻页保留，删除弹窗需要展示摘要）
  const [selectedItems, setSelectedItems] = useState<Map<string, ActivitySummary>>(new Map())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  // 勾选批量纠偏：与批量删除同一勾选集（作者快照只读，入口同样隐藏）
  const [fixDialogOpen, setFixDialogOpen] = useState(false)
  // 距离显示单位（规格 §27）
  const { distance: distanceUnit } = useUnits()

  // 筛选条件 → 仓库查询参数（数值：空/非法 = 不限制；单位换算 km → 米；
  // 自定义条件换算为各字段 min/max 边界，与既有 min 输入取更紧者叠加，保持 AND 语义）
  const filterOptions = useMemo<ActivityListOptions>(() => {
    const minDistanceKm = parseNumericFilter(filters.minDistanceKm)
    const minElevationGain = parseNumericFilter(filters.minElevationGain)
    const minAvgPower = parseNumericFilter(filters.minAvgPower)
    const custom = conditionsToBounds(filters.customFilters)
    return {
      search: filters.search || undefined,
      month: filters.month || undefined,
      activityType: filters.activityType || undefined,
      minDistance: tighterMin(
        minDistanceKm === undefined ? undefined : Math.round(minDistanceKm * 1000),
        custom.minDistance,
      ),
      maxDistance: custom.maxDistance,
      minElevationGain: tighterMin(minElevationGain, custom.minElevationGain),
      maxElevationGain: custom.maxElevationGain,
      minDuration: custom.minDuration,
      maxDuration: custom.maxDuration,
      minAvgSpeed: custom.minAvgSpeed,
      maxAvgSpeed: custom.maxAvgSpeed,
      minAvgHeartRate: custom.minAvgHeartRate,
      maxAvgHeartRate: custom.maxAvgHeartRate,
      minAvgPower: tighterMin(minAvgPower, custom.minAvgPower),
      maxAvgPower: custom.maxAvgPower,
      startTimeFrom: custom.startTimeFrom,
      startTimeTo: custom.startTimeTo,
    }
  }, [filters.search, filters.month, filters.activityType, filters.minDistanceKm, filters.minElevationGain, filters.minAvgPower, filters.customFilters])

  const listQuery = useMemo(
    () => ({
      ...query,
      sortBy: filters.sortField,
      sortOrder: filters.sortOrder,
      ...filterOptions,
    }),
    [query, filters.sortField, filters.sortOrder, filterOptions],
  )

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

  // 表头排序：点击新列按降序，点击当前列切换方向，同时回到第一页；排序持久化（不自动重置）
  function handleSortChange(field: SortField) {
    filters.setSort(
      field,
      filters.sortField === field ? (filters.sortOrder === 'asc' ? 'desc' : 'asc') : 'desc',
    )
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  // 手动重置排序（切筛选/翻页/刷新均不重置排序，仅此按钮还原默认）
  function handleResetSort() {
    filters.resetSort()
    setQuery((prev) => ({ ...prev, offset: 0 }))
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

  // 自定义筛选：添加条件 / 移除单条（chips ×）
  function handleAddCustomCondition(condition: CustomFilterCondition) {
    filters.addCustomFilter(condition)
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  function handleRemoveCustomCondition(index: number) {
    filters.removeCustomFilter(index)
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  // 预设：保存（编辑态改名 = 删旧名存新名）/ 另存（同名确认覆盖）/ 套用 / 删除
  function handleSavePreset(name: string, conditions: CustomFilterCondition[]) {
    if (filters.editingPreset !== null && filters.editingPreset !== name) {
      filters.deletePreset(filters.editingPreset)
    }
    filters.savePreset(name, conditions)
    filters.setEditingPreset(name)
  }

  function handleSavePresetAs(name: string, conditions: CustomFilterCondition[]) {
    if (filters.presets[name] !== undefined && !window.confirm(`预设「${name}」已存在，覆盖它？`)) {
      return
    }
    filters.savePreset(name, conditions)
    filters.setEditingPreset(name)
  }

  function handleApplyPreset(name: string) {
    const conditions = filters.presets[name]
    if (conditions === undefined) {
      return
    }
    filters.setCustomFilters(conditions.map((condition) => ({ ...condition })))
    filters.setEditingPreset(name)
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  function handleDeletePreset(name: string) {
    if (!window.confirm(`删除预设「${name}」？（不影响当前生效的筛选条件）`)) {
      return
    }
    filters.deletePreset(name)
    if (filters.editingPreset === name) {
      filters.setEditingPreset(null)
    }
  }

  // 重置：清空全部筛选条件（含自定义条件，仅手动触发）并回到第一页
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

  // 勾选：单行切换（记录摘要供删除弹窗展示）/ 当前页全选（翻页保留已勾选）
  function handleToggleSelect(id: string, checked: boolean, item: ActivitySummary) {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (checked) {
        next.set(id, item)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  function handleToggleSelectAll(checked: boolean, pageItems: readonly ActivitySummary[]) {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      for (const item of pageItems) {
        if (checked) {
          next.set(item.id, item)
        } else {
          next.delete(item.id)
        }
      }
      return next
    })
  }

  function handleDeleted(count: number) {
    setDeleteDialogOpen(false)
    setSelectedItems(new Map())
    setReloadKey((k) => k + 1)
    console.info(`Deleted ${count} activities`)
  }

  /** 批量纠偏完成：清空勾选并刷新列表（坐标系纳入 scanKey 指纹，热力图等自动重算） */
  function handleFixed(count: number) {
    setFixDialogOpen(false)
    setSelectedItems(new Map())
    setReloadKey((k) => k + 1)
    console.info(`Fixed coordinate system for ${count} activities`)
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
    filters.minAvgPower.trim() !== '' ||
    filters.customFilters.length > 0

  // 勾选批量删除仅本地数据源可用（作者快照只读）
  const selectable = effectiveSource === 'local'
  const selectedCount = selectedItems.size

  // 自定义条件 chips（类型下拉右侧展示，× 移除单条）
  const customFilterChips =
    filters.customFilters.length > 0 ? (
      <>
        {filters.customFilters.map((condition, index) => (
          <span key={`${condition.field}-${condition.op}-${condition.value}-${index}`} className="activity-filter-chip">
            {describeCondition(condition)}
            <button
              type="button"
              className="activity-filter-chip__remove"
              aria-label={`移除条件 ${describeCondition(condition)}`}
              onClick={() => handleRemoveCustomCondition(index)}
            >
              ×
            </button>
          </span>
        ))}
      </>
    ) : null

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
        chips={customFilterChips}
        onReset={handleResetFilters}
        onOpenBatchRename={handleOpenBatchRename}
        batchRenameDisabled={effectiveSource !== 'local'}
        batchRenameDisabledReason="作者快照为只读数据，请切换到本地数据源后重命名"
      />
      <CustomFilterPanel
        conditions={filters.customFilters}
        presets={filters.presets}
        editingPreset={filters.editingPreset}
        onAdd={handleAddCustomCondition}
        onSavePreset={handleSavePreset}
        onSavePresetAs={handleSavePresetAs}
        onDeletePreset={handleDeletePreset}
        onApplyPreset={handleApplyPreset}
        onExitEdit={() => filters.setEditingPreset(null)}
      />
      {/* 排序状态条：排序持久化不自动重置，仅手动重置还原 */}
      <div className="activity-sort-bar">
        <span>
          排序：
          <strong className="activity-sort-bar__current">
            {SORT_FIELD_LABELS[filters.sortField]} {filters.sortOrder === 'desc' ? '降序' : '升序'}
          </strong>
        </span>
        <button type="button" className="activity-sort-bar__reset" onClick={handleResetSort}>
          重置排序
        </button>
        {selectable && selectedCount > 0 && (
          <div className="activity-selection-bar">
            <span className="activity-selection-bar__info">已勾选 {selectedCount} 条</span>
            <button type="button" className="activity-selection-bar__button" onClick={() => setSelectedItems(new Map())}>
              取消勾选
            </button>
            <button
              type="button"
              className="activity-selection-bar__button activity-selection-bar__button--danger"
              onClick={() => setDeleteDialogOpen(true)}
            >
              删除选中
            </button>
            <button
              type="button"
              className="activity-selection-bar__button"
              onClick={() => setFixDialogOpen(true)}
              title="批量设置轨迹坐标系（行者 / Keep 等国内 App 导入的记录位置不对时使用）"
            >
              轨迹纠偏
            </button>
          </div>
        )}
      </div>
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
            sortBy={filters.sortField}
            sortOrder={filters.sortOrder}
            onSortChange={handleSortChange}
            onRowClick={handleRowClick}
            distanceUnit={distanceUnit}
            selectable={selectable}
            selectedIds={new Set(selectedItems.keys())}
            onToggleSelect={(id, checked) => {
              const item = result.items.find((entry) => entry.id === id)
              if (item !== undefined) {
                handleToggleSelect(id, checked, item)
              }
            }}
            onToggleSelectAll={(checked) => handleToggleSelectAll(checked, result.items)}
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
      {deleteDialogOpen && selectedCount > 0 && (
        <DeleteActivitiesDialog
          items={[...selectedItems.values()]}
          writeRepository={writeRepository}
          onClose={() => setDeleteDialogOpen(false)}
          onDeleted={handleDeleted}
        />
      )}
      {fixDialogOpen && selectedCount > 0 && (
        <BatchFixDialog
          items={[...selectedItems.values()]}
          writeRepository={writeRepository}
          onClose={() => setFixDialogOpen(false)}
          onFixed={handleFixed}
        />
      )}
    </div>
  )
}

export default ActivitiesPage
