/**
 * 骑行记录列表页（Phase 5，规格 §14；2026-09 工具栏改版）。
 * 数据来自活动仓库的分页查询，支持排序、搜索、年份/月份筛选、
 * 自定义条件筛选（弹窗多选预设 + 大于/等于/小于/介于）与分页浏览（每页大小可选）；
 * 行点击跳转详情页。repository 支持测试注入（缺省使用当前数据源仓库）。
 *
 * 筛选条件、排序状态、自定义条件、筛选预设与每页条数均存于 activityFilterStore
 * （zustand persist）：切页/刷新/切筛选不丢，仅手动「重置」/「重置排序」还原。
 * 勾选批量删除仅本地数据源可用（作者快照只读，勾选列隐藏）；
 * 批量重命名 / 轨迹纠偏作用于当前筛选命中的全部记录（本地源可用）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ActivityEmptyState from '@/features/activity/ActivityEmptyState'
import ActivityFilters from '@/features/activity/ActivityFilters'
import ActivityListTable, { type SortField } from '@/features/activity/ActivityListTable'
import ActivityPagination from '@/features/activity/ActivityPagination'
import BatchRenameDialog from '@/features/activity/BatchRenameDialog'
import CustomFilterDialog from '@/features/activity/CustomFilterDialog'
import DeleteActivitiesDialog from '@/features/activity/DeleteActivitiesDialog'
import BatchFixDialog from '@/features/activity/BatchFixDialog'
import BatchActivityTypeDialog from '@/features/activity/BatchActivityTypeDialog'
import { detectTypeSuspects, toManualSuspects, type TypeSuspect } from '@/features/activity/suspectTypes'
import { conditionsToBounds, describeCondition, type CustomFilterCondition } from '@/features/activity/customFilter'
import { ACTIVITY_TYPE_OPTIONS } from '@/types/activityType'
import '@/features/activity/activity-page.css'
import { useUnits } from '@/hooks/useUnits'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_FIELD,
  DEFAULT_SORT_ORDER,
  useActivityFilterStore,
} from '@/stores/activityFilterStore'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import {
  type ActivityReadRepository,
  type ActivityRepository,
  type ActivitySummary,
  type ActivityListOptions,
} from '@/storage/repositories/activityRepository'

/**
 * 列表分页参数（筛选/排序条件在 activityFilterStore，每页条数走 store 持久化）。
 */
interface QueryState {
  offset: number
}

const DEFAULT_QUERY: QueryState = { offset: 0 }

interface ActivitiesPageProps {
  /** 活动仓库（测试注入用；缺省经门面按当前数据源分发） */
  repository?: ActivityReadRepository

  /** 本地写仓库（批量重命名/批量删除/批量纠偏测试注入；缺省弹窗内部直连 Dexie） */
  writeRepository?: Pick<
    ActivityRepository,
    'updateName' | 'deleteActivity' | 'deleteActivities' | 'updateTrackSystem' | 'updateActivityType'
  >
}

/**
 * 骑行记录列表页。
 */
function ActivitiesPage({ repository, writeRepository }: ActivitiesPageProps) {
  const navigate = useNavigate()
  // 缺省使用当前数据源的仓库（源切换 → 实例变化 → 重新加载）；测试可注入
  const sourceRepository = useActivityRepository()
  const repo = repository ?? sourceRepository

  // 筛选/排序/自定义条件/预设/每页条数：持久化 store（切页/刷新不丢，仅重置按钮清空筛选）
  const filters = useActivityFilterStore()
  // 有效数据源：作者快照只读，批量重命名/轨迹纠偏禁用、勾选删除隐藏
  const effectiveSource = useDataSourceStore(selectEffectiveSource)

  const [query, setQuery] = useState<QueryState>(DEFAULT_QUERY)
  const [result, setResult] = useState<{ items: ActivitySummary[]; total: number }>({
    items: [],
    total: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [settledQuery, setSettledQuery] = useState<object | null>(null)
  const [months, setMonths] = useState<string[]>([])
  const [years, setYears] = useState<string[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  // 批量重命名弹窗：候选为当前筛选命中的全部记录（非仅当前页）
  const [renameItems, setRenameItems] = useState<ActivitySummary[] | null>(null)
  // 批量轨迹纠偏弹窗：候选同样为当前筛选命中的全部记录
  const [fixItems, setFixItems] = useState<ActivitySummary[] | null>(null)
  // 自定义筛选弹窗（预设列表多选 + 新建/修改）
  const [customFilterOpen, setCustomFilterOpen] = useState(false)
  // 批量修正运动类型：全量摘要（检测候选 + 影响预览）+ 候选列表 + 弹窗开关
  const [allSummaries, setAllSummaries] = useState<ActivitySummary[]>([])
  const [typeSuspects, setTypeSuspects] = useState<TypeSuspect[]>([])
  const [typeFixOpen, setTypeFixOpen] = useState(false)
  // 勾选批量删除：ID → 摘要（跨翻页保留，删除弹窗需要展示摘要）
  const [selectedItems, setSelectedItems] = useState<Map<string, ActivitySummary>>(new Map())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  // 勾选批量改类型：候选来自用户勾选（与自动检测弹窗互不影响）
  const [manualTypeSuspects, setManualTypeSuspects] = useState<TypeSuspect[] | null>(null)
  // 距离显示单位（规格 §27）
  const { distance: distanceUnit } = useUnits()

  // 每页条数（store 持久化；防御非法持久化值回落默认）
  const pageSize = filters.pageSize > 0 ? filters.pageSize : DEFAULT_PAGE_SIZE

  // 月份选项按所选年份过滤（未选年份展示全部月份）
  const monthOptions = useMemo(
    () => (filters.year === '' ? months : months.filter((m) => m.startsWith(filters.year))),
    [months, filters.year],
  )

  // 筛选条件 → 仓库查询参数（自定义条件换算为各字段 min/max 边界，多条件 AND）
  const filterOptions = useMemo<ActivityListOptions>(() => {
    const custom = conditionsToBounds(filters.customFilters)
    return {
      search: filters.search || undefined,
      year: filters.year || undefined,
      month: filters.month || undefined,
      activityType: filters.activityType || undefined,
      minDistance: custom.minDistance,
      maxDistance: custom.maxDistance,
      minElevationGain: custom.minElevationGain,
      maxElevationGain: custom.maxElevationGain,
      minDuration: custom.minDuration,
      maxDuration: custom.maxDuration,
      minAvgSpeed: custom.minAvgSpeed,
      maxAvgSpeed: custom.maxAvgSpeed,
      minAvgHeartRate: custom.minAvgHeartRate,
      maxAvgHeartRate: custom.maxAvgHeartRate,
      minAvgPower: custom.minAvgPower,
      maxAvgPower: custom.maxAvgPower,
      startTimeFrom: custom.startTimeFrom,
      startTimeTo: custom.startTimeTo,
    }
  }, [
    filters.search,
    filters.year,
    filters.month,
    filters.activityType,
    filters.customFilters,
  ])

  const listQuery = useMemo(
    () => ({
      ...query,
      sortBy: filters.sortField,
      sortOrder: filters.sortOrder,
      ...filterOptions,
    }),
    [query, filters.sortField, filters.sortOrder, filterOptions],
  )

  // 挂载时从全量数据生成年份/月份筛选选项
  useEffect(() => {
    let cancelled = false
    repo
      .listActivities({ limit: 0, sortBy: 'startTime', sortOrder: 'desc' })
      .then((result) => {
        if (cancelled) {
          return
        }
        const monthSet = new Set<string>()
        const yearSet = new Set<string>()
        for (const item of result.items) {
          monthSet.add(item.startTime.slice(0, 7))
          yearSet.add(item.startTime.slice(0, 4))
        }
        // 显式降序：不依赖仓库返回顺序，保证下拉恒为「最新在前」
        setMonths([...monthSet].sort((a, b) => b.localeCompare(a)))
        setYears([...yearSet].sort((a, b) => b.localeCompare(a)))
        // 顺带做一次类型复核检测（只读）：全量摘要是检测与影响预览的共同输入。
        // 放在这里而非单独请求，避免全表再查一遍
        setAllSummaries(result.items)
        setTypeSuspects(detectTypeSuspects(result.items))
      })
      .catch(() => {
        // 选项加载失败不阻塞列表展示
      })
    return () => {
      cancelled = true
    }
  }, [repo, reloadKey])

  // 查询参数变化时重新加载列表（排序/筛选/翻页/每页条数均触发）
  useEffect(() => {
    let cancelled = false
    repo
      .listActivities({ ...listQuery, limit: pageSize })
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
  }, [listQuery, repo, reloadKey, pageSize])

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

  /** 筛选变更通用：写入后回到第一页 */
  function applyFilterAndResetPage(apply: () => void) {
    apply()
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  // 年份变更：若当前选中月份不属于新年份则清空月份
  function handleYearChange(year: string) {
    applyFilterAndResetPage(() => {
      filters.setYear(year)
      if (year !== '' && filters.month !== '' && !filters.month.startsWith(year)) {
        filters.setMonth('')
      }
    })
  }

  function handleMonthChange(month: string) {
    applyFilterAndResetPage(() => filters.setMonth(month))
  }

  function handleSearchChange(search: string) {
    applyFilterAndResetPage(() => filters.setSearch(search))
  }

  // 每页条数变更：写入 store 并回到第一页
  function handlePageSizeChange(size: number) {
    filters.setPageSize(size)
    setQuery((prev) => ({ ...prev, offset: 0 }))
  }

  // 自定义筛选 chips：移除单条
  function handleRemoveCustomCondition(index: number) {
    applyFilterAndResetPage(() => filters.removeCustomFilter(index))
  }

  // 自定义筛选弹窗：保存预设（同名覆盖确认在弹窗内完成）
  function handleSavePreset(name: string, conditions: CustomFilterCondition[]) {
    filters.savePreset(name, conditions)
  }

  // 自定义筛选弹窗：批量删除预设
  function handleDeletePresets(names: string[]) {
    for (const name of names) {
      filters.deletePreset(name)
    }
  }

  // 工具栏预设下拉：选中即套用该预设条件（条件并集口径与弹窗多选一致）
  function handleApplyPreset(name: string) {
    const conditions = (filters.presets[name] ?? []).map((condition) => ({ ...condition }))
    applyFilterAndResetPage(() => filters.setCustomFilters(conditions))
  }

  // 自定义筛选弹窗：多选套用（勾选预设条件并集写入当前筛选）
  function handleApplyPresets(names: string[]) {
    const conditions = names.flatMap((name) => filters.presets[name] ?? []).map((condition) => ({ ...condition }))
    applyFilterAndResetPage(() => filters.setCustomFilters(conditions))
    setCustomFilterOpen(false)
  }

  // 重置：清空全部筛选条件（含自定义条件，仅手动触发）并回到第一页
  function handleResetFilters() {
    applyFilterAndResetPage(() => filters.resetFilters())
  }

  // 打开批量重命名/轨迹纠偏：取当前筛选命中的全部记录（不分页）
  async function loadFilteredAll(): Promise<ActivitySummary[]> {
    const all = await repo.listActivities({ ...filterOptions, limit: 0 })
    return all.items
  }

  async function handleOpenBatchRename() {
    try {
      setRenameItems(await loadFilteredAll())
    } catch (err: unknown) {
      console.error('Failed to load activities for batch rename', err)
    }
  }

  async function handleOpenBatchFix() {
    try {
      setFixItems(await loadFilteredAll())
    } catch (err: unknown) {
      console.error('Failed to load activities for batch fix', err)
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

  /** 批量纠偏完成：刷新列表（坐标系纳入 scanKey 指纹，热力图等自动重算） */
  function handleFixed(count: number) {
    setFixItems(null)
    setReloadKey((k) => k + 1)
    console.info(`Fixed coordinate system for ${count} activities`)
  }

  /**
   * 批量修正运动类型完成：刷新列表并重新检测候选。
   *
   * 类型不属于 scanKey 指纹（扫描缓存按骑行集合计算，过滤后指纹自然变化），
   * 故热力图等页面下次进入会自动重算，无需额外失效处理。
   */
  function handleTypeFixed(count: number) {
    setReloadKey((k) => k + 1)
    console.info(`Fixed activity type for ${count} activities`)
  }

  /**
   * 打开手动改类型弹窗：候选 = 当前勾选记录（toManualSuspects 内部按开始时间倒序）。
   */
  function openManualTypeFix() {
    if (selectedItems.size === 0) {
      return
    }
    setManualTypeSuspects(toManualSuspects([...selectedItems.values()]))
  }

  /**
   * 手动改类型完成：清勾选并刷新列表（类型写入后检测候选、列表类型列都需重算）。
   */
  function handleManualTypeFixed(count: number) {
    setManualTypeSuspects(null)
    setSelectedItems(new Map())
    setReloadKey((k) => k + 1)
    console.info(`Manually updated activity type for ${count} activities`)
  }

  // 分页：切页 / 翻页（每页条数变更单独处理并回第一页）
  function handlePageChange(page: number) {
    setQuery((prev) => ({ ...prev, offset: (page - 1) * pageSize }))
  }

  function handleRowClick(id: string) {
    navigate(`/activities/${id}`)
  }

  const page = Math.floor(query.offset / pageSize) + 1
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize))
  // 当前生效条件（空态展示用：说清是哪条把结果筛没了；非空即处于筛选态）
  const activeConditions = useMemo(() => {
    const labels: string[] = []
    const keyword = filters.search.trim()
    if (keyword !== '') {
      labels.push(`搜索「${keyword}」`)
    }
    if (filters.year !== '') {
      labels.push(`${filters.year} 年`)
    }
    if (filters.month !== '') {
      labels.push(filters.month)
    }
    if (filters.activityType !== '') {
      const label = ACTIVITY_TYPE_OPTIONS.find((option) => option.value === filters.activityType)?.label
      labels.push(label ?? filters.activityType)
    }
    for (const condition of filters.customFilters) {
      labels.push(describeCondition(condition))
    }
    return labels
  }, [filters.search, filters.year, filters.month, filters.activityType, filters.customFilters])

  // 排序偏离默认（日期降序）时才显示「重置排序」按钮（2026-09 用户指定：去掉状态文案仅留按钮）
  const sortNotDefault =
    filters.sortField !== DEFAULT_SORT_FIELD || filters.sortOrder !== DEFAULT_SORT_ORDER

  // 批量重命名/轨迹纠偏仅本地数据源可用（作者快照只读）；勾选删除同样仅本地源
  const selectable = effectiveSource === 'local'
  const batchDisabled = effectiveSource !== 'local'
  const batchDisabledReason = '作者快照为只读数据，请切换到本地数据源后操作'
  const selectedCount = selectedItems.size

  // 自定义条件 chips（搜索框右侧展示，× 移除单条）
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
        years={years}
        months={monthOptions}
        year={filters.year}
        month={filters.month}
        activityType={filters.activityType}
        search={filters.search}
        onYearChange={handleYearChange}
        onMonthChange={handleMonthChange}
        onActivityTypeChange={filters.setActivityType}
        onSearchChange={handleSearchChange}
        presetNames={Object.keys(filters.presets)}
        onApplyPreset={handleApplyPreset}
        chips={customFilterChips}
        onOpenCustomFilter={() => setCustomFilterOpen(true)}
        onReset={handleResetFilters}
        onOpenBatchFix={handleOpenBatchFix}
        batchFixDisabled={batchDisabled}
        batchFixDisabledReason={batchDisabledReason}
        onOpenBatchRename={handleOpenBatchRename}
        batchRenameDisabled={batchDisabled}
        batchRenameDisabledReason={batchDisabledReason}
        onOpenBatchType={() => setTypeFixOpen(true)}
        batchTypeSuspectCount={typeSuspects.length}
        batchTypeDisabled={batchDisabled}
        batchTypeDisabledReason={batchDisabledReason}
      />
      {/* 排序操作条：状态文案已移除（用户指定），仅排序偏离默认时显示重置按钮；兼勾选操作区 */}
      <div className="activity-sort-bar">
        {sortNotDefault && (
          <button type="button" className="activity-sort-bar__reset" onClick={handleResetSort}>
            重置排序
          </button>
        )}
        {selectable && selectedCount > 0 && (
          <div className="activity-selection-bar">
            <span className="activity-selection-bar__info">已勾选 {selectedCount} 条</span>
            <button type="button" className="activity-selection-bar__button" onClick={() => setSelectedItems(new Map())}>
              取消勾选
            </button>
            <button
              type="button"
              className="activity-selection-bar__button"
              onClick={openManualTypeFix}
            >
              修正类型
            </button>
            <button
              type="button"
              className="activity-selection-bar__button activity-selection-bar__button--danger"
              onClick={() => setDeleteDialogOpen(true)}
            >
              删除选中
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
        <ActivityEmptyState
          filtered={activeConditions.length > 0}
          totalCount={allSummaries.length}
          conditions={activeConditions}
          onReset={handleResetFilters}
        />
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
          <ActivityPagination
            page={page}
            totalPages={totalPages}
            total={result.total}
            pageSize={pageSize}
            disabled={loading}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </>
      )}
      {customFilterOpen && (
        <CustomFilterDialog
          presets={filters.presets}
          onApply={handleApplyPresets}
          onSavePreset={handleSavePreset}
          onDeletePresets={handleDeletePresets}
          onClose={() => setCustomFilterOpen(false)}
        />
      )}
      {renameItems !== null && (
        <BatchRenameDialog
          items={renameItems}
          writeRepository={writeRepository}
          onClose={() => setRenameItems(null)}
          onRenamed={handleRenamed}
        />
      )}
      {fixItems !== null && (
        <BatchFixDialog
          items={fixItems}
          writeRepository={writeRepository}
          onClose={() => setFixItems(null)}
          onFixed={handleFixed}
        />
      )}
      {typeFixOpen && (
        <BatchActivityTypeDialog
          suspects={typeSuspects}
          allSummaries={allSummaries}
          writeRepository={writeRepository}
          distanceUnit={distanceUnit}
          onClose={() => setTypeFixOpen(false)}
          onApplied={handleTypeFixed}
        />
      )}
      {manualTypeSuspects !== null && (
        <BatchActivityTypeDialog
          mode="manual"
          suspects={manualTypeSuspects}
          allSummaries={allSummaries}
          writeRepository={writeRepository}
          distanceUnit={distanceUnit}
          onClose={() => setManualTypeSuspects(null)}
          onApplied={handleManualTypeFixed}
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
    </div>
  )
}

export default ActivitiesPage
