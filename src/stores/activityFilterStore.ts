/**
 * 骑行记录筛选条件 store（zustand + persist）。
 *
 * 筛选条件持久化到 localStorage：离开页面/刷新后仍保留，仅用户点击
 * 「重置」按钮才恢复默认（规格外增强，用户明确要求"筛选不要自动清理"）。
 * 存储的是输入框原始字符串（空字符串 = 不限制），数值解析由页面完成，
 * 保证刷新后输入框回显与筛选行为一致。
 *
 * 扩展（2026-09，用户评审原型后立项）：
 * - 排序字段/方向持久化：切筛选/翻页/刷新均不重置，仅「重置排序」按钮还原
 * - 自定义筛选条件（规范化条件列表）与筛选预设（命名条件组）持久化，
 *   预设可套用/编辑/改名/删除；编辑态（editingPreset）不持久化，刷新后回到新建模式
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CustomFilterCondition } from '@/features/activity/customFilter'

/** 列表排序字段（与仓库 sortBy 一致，覆盖全部 8 列） */
export type ActivitySortField =
  | 'name'
  | 'startTime'
  | 'distance'
  | 'duration'
  | 'elevationGain'
  | 'avgSpeed'
  | 'avgHeartRate'
  | 'avgPower'

/** 列表排序方向 */
export type ActivitySortOrder = 'asc' | 'desc'

/** 默认排序（开始时间降序） */
export const DEFAULT_SORT_FIELD: ActivitySortField = 'startTime'
export const DEFAULT_SORT_ORDER: ActivitySortOrder = 'desc'

/** 筛选条件 store 状态与 actions */
export interface ActivityFilterState {
  /** 搜索关键词（空 = 不限制） */
  search: string

  /** 月份筛选（'2026-08'，空 = 全部月份） */
  month: string

  /** 运动类型筛选（空 = 全部类型） */
  activityType: string

  /** 最小距离输入原始串（km，空 = 不限制） */
  minDistanceKm: string

  /** 最小爬升输入原始串（m，空 = 不限制） */
  minElevationGain: string

  /** 最小平均功率输入原始串（W，空 = 不限制） */
  minAvgPower: string

  /** 当前排序字段（持久化，仅手动重置还原） */
  sortField: ActivitySortField

  /** 当前排序方向（持久化） */
  sortOrder: ActivitySortOrder

  /** 自定义筛选条件（规范化条件，持久化；空列表 = 无自定义条件） */
  customFilters: CustomFilterCondition[]

  /** 已保存筛选预设（名字 → 条件列表，持久化） */
  presets: Record<string, CustomFilterCondition[]>

  /** 正在编辑的预设名（null = 新建模式；不持久化） */
  editingPreset: string | null

  /** 设置搜索关键词 */
  setSearch(search: string): void

  /** 设置月份筛选 */
  setMonth(month: string): void

  /** 设置运动类型筛选 */
  setActivityType(activityType: string): void

  /** 设置最小距离输入 */
  setMinDistanceKm(value: string): void

  /** 设置最小爬升输入 */
  setMinElevationGain(value: string): void

  /** 设置最小平均功率输入 */
  setMinAvgPower(value: string): void

  /** 设置排序（表头点击） */
  setSort(field: ActivitySortField, order: ActivitySortOrder): void

  /** 重置排序为默认（仅「重置排序」按钮调用） */
  resetSort(): void

  /** 添加一条自定义筛选条件 */
  addCustomFilter(condition: CustomFilterCondition): void

  /** 按索引移除自定义筛选条件 */
  removeCustomFilter(index: number): void

  /** 整体替换自定义筛选条件（套用/编辑预设时用） */
  setCustomFilters(conditions: CustomFilterCondition[]): void

  /** 保存预设（同名覆盖；编辑改名时由调用方先 deletePreset 旧名） */
  savePreset(name: string, conditions: CustomFilterCondition[]): void

  /** 删除预设 */
  deletePreset(name: string): void

  /** 设置编辑中的预设名（null = 退出编辑） */
  setEditingPreset(name: string | null): void

  /** 重置全部筛选条件为默认（仅「重置」按钮调用；不清预设、不动排序） */
  resetFilters(): void
}

/** 筛选条件 store 实例（persist key：cycling-activity-filters） */
export const useActivityFilterStore = create<ActivityFilterState>()(
  persist(
    (set) => ({
      search: '',
      month: '',
      activityType: '',
      minDistanceKm: '',
      minElevationGain: '',
      minAvgPower: '',
      sortField: DEFAULT_SORT_FIELD,
      sortOrder: DEFAULT_SORT_ORDER,
      customFilters: [],
      presets: {},
      editingPreset: null,
      setSearch: (search) => set({ search }),
      setMonth: (month) => set({ month }),
      setActivityType: (activityType) => set({ activityType }),
      setMinDistanceKm: (minDistanceKm) => set({ minDistanceKm }),
      setMinElevationGain: (minElevationGain) => set({ minElevationGain }),
      setMinAvgPower: (minAvgPower) => set({ minAvgPower }),
      setSort: (sortField, sortOrder) => set({ sortField, sortOrder }),
      resetSort: () =>
        set({ sortField: DEFAULT_SORT_FIELD, sortOrder: DEFAULT_SORT_ORDER }),
      addCustomFilter: (condition) =>
        set((state) => ({ customFilters: [...state.customFilters, condition] })),
      removeCustomFilter: (index) =>
        set((state) => ({
          customFilters: state.customFilters.filter((_, i) => i !== index),
        })),
      setCustomFilters: (customFilters) => set({ customFilters }),
      savePreset: (name, conditions) =>
        set((state) => ({ presets: { ...state.presets, [name]: conditions } })),
      deletePreset: (name) =>
        set((state) => {
          const presets = { ...state.presets }
          delete presets[name]
          return { presets }
        }),
      setEditingPreset: (editingPreset) => set({ editingPreset }),
      resetFilters: () =>
        set({
          search: '',
          month: '',
          activityType: '',
          minDistanceKm: '',
          minElevationGain: '',
          minAvgPower: '',
          customFilters: [],
          editingPreset: null,
        }),
    }),
    {
      name: 'cycling-activity-filters',
      partialize: (state) => ({
        search: state.search,
        month: state.month,
        activityType: state.activityType,
        minDistanceKm: state.minDistanceKm,
        minElevationGain: state.minElevationGain,
        minAvgPower: state.minAvgPower,
        sortField: state.sortField,
        sortOrder: state.sortOrder,
        customFilters: state.customFilters,
        presets: state.presets,
      }),
    },
  ),
)
