/**
 * 骑行记录筛选条件 store（zustand + persist）。
 *
 * 筛选条件持久化到 localStorage：离开页面/刷新后仍保留，仅用户点击
 * 「重置」按钮才恢复默认（规格外增强，用户明确要求"筛选不要自动清理"）。
 * 存储的是输入框原始字符串（空字符串 = 不限制），数值解析由页面完成，
 * 保证刷新后输入框回显与筛选行为一致。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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

  /** 重置全部筛选条件为默认（仅「重置」按钮调用） */
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
      setSearch: (search) => set({ search }),
      setMonth: (month) => set({ month }),
      setActivityType: (activityType) => set({ activityType }),
      setMinDistanceKm: (minDistanceKm) => set({ minDistanceKm }),
      setMinElevationGain: (minElevationGain) => set({ minElevationGain }),
      setMinAvgPower: (minAvgPower) => set({ minAvgPower }),
      resetFilters: () =>
        set({
          search: '',
          month: '',
          activityType: '',
          minDistanceKm: '',
          minElevationGain: '',
          minAvgPower: '',
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
      }),
    },
  ),
)
