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
 *   预设可在「自定义筛选」弹窗中多选套用/新建/修改/删除
 * - 年份筛选与每页条数（pageSize）持久化（2026-09 列表页工具栏改版）
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

/** 每页条数可选项（上限 500，用户指定） */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200, 500] as const

/** 默认每页条数 */
export const DEFAULT_PAGE_SIZE = 20

/** 每页条数上限 */
export const MAX_PAGE_SIZE = 500

/** 筛选条件 store 状态与 actions */
export interface ActivityFilterState {
  /** 搜索关键词（空 = 不限制） */
  search: string

  /** 年份筛选（'2026'，空 = 全部年份） */
  year: string

  /** 月份筛选（'2026-08'，空 = 全部月份） */
  month: string

  /** 当前排序字段（持久化，仅手动重置还原） */
  sortField: ActivitySortField

  /** 当前排序方向（持久化） */
  sortOrder: ActivitySortOrder

  /** 每页条数（持久化，上限 MAX_PAGE_SIZE） */
  pageSize: number

  /** 自定义筛选条件（规范化条件，持久化；空列表 = 无自定义条件） */
  customFilters: CustomFilterCondition[]

  /** 已保存筛选预设（名字 → 条件列表，持久化） */
  presets: Record<string, CustomFilterCondition[]>

  /** 设置搜索关键词 */
  setSearch(search: string): void

  /** 设置年份筛选 */
  setYear(year: string): void

  /** 设置月份筛选 */
  setMonth(month: string): void

  /** 设置排序（表头点击） */
  setSort(field: ActivitySortField, order: ActivitySortOrder): void

  /** 重置排序为默认（仅「重置排序」按钮调用） */
  resetSort(): void

  /** 设置每页条数（超出上限按上限处理） */
  setPageSize(size: number): void

  /** 添加一条自定义筛选条件 */
  addCustomFilter(condition: CustomFilterCondition): void

  /** 按索引移除自定义筛选条件 */
  removeCustomFilter(index: number): void

  /** 整体替换自定义筛选条件（弹窗多选套用预设时用） */
  setCustomFilters(conditions: CustomFilterCondition[]): void

  /** 保存预设（同名覆盖） */
  savePreset(name: string, conditions: CustomFilterCondition[]): void

  /** 删除预设 */
  deletePreset(name: string): void

  /** 重置全部筛选条件为默认（仅「重置」按钮调用；不清预设、不动排序与每页条数） */
  resetFilters(): void
}

/** 筛选条件 store 实例（persist key：cycling-activity-filters） */
export const useActivityFilterStore = create<ActivityFilterState>()(
  persist(
    (set) => ({
      search: '',
      year: '',
      month: '',
      sortField: DEFAULT_SORT_FIELD,
      sortOrder: DEFAULT_SORT_ORDER,
      pageSize: DEFAULT_PAGE_SIZE,
      customFilters: [],
      presets: {},
      setSearch: (search) => set({ search }),
      setYear: (year) => set({ year }),
      setMonth: (month) => set({ month }),
      setSort: (sortField, sortOrder) => set({ sortField, sortOrder }),
      resetSort: () =>
        set({ sortField: DEFAULT_SORT_FIELD, sortOrder: DEFAULT_SORT_ORDER }),
      setPageSize: (size) =>
        set({ pageSize: Math.min(Math.max(1, Math.round(size)), MAX_PAGE_SIZE) }),
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
      resetFilters: () =>
        set({
          search: '',
          year: '',
          month: '',
          customFilters: [],
        }),
    }),
    {
      name: 'cycling-activity-filters',
      partialize: (state) => ({
        search: state.search,
        year: state.year,
        month: state.month,
        sortField: state.sortField,
        sortOrder: state.sortOrder,
        pageSize: state.pageSize,
        customFilters: state.customFilters,
        presets: state.presets,
      }),
    },
  ),
)
