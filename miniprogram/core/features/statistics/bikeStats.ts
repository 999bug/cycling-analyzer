/**
 * 自行车统计聚合纯函数（规格 §39 自行车统计）。
 *
 * 输入 listAllSummaries() 输出的摘要列表，按单车名称分组聚合：
 * 活动次数、总距离、总时长、总爬升与最近一次骑行时间。
 *
 * 单车名来自 FIT session 的 sport_profile_name（骑行设备所选单车）。
 * 缺失单车名的活动归「未知自行车」组（不伪造，规格 §25）。
 * 结果按活动次数降序，次数相同按显示名升序（保证输出稳定）。
 * 全时段口径，与统计页范围选择无关。
 */
import type { ActivitySummary } from '../../storage/repositories/activityRepository'

/** 无单车信息活动的归组显示名 */
export const UNKNOWN_BIKE_NAME = '未知自行车'

/**
 * 自行车统计条目。
 */
export interface BikeStatsEntry {
  /** 单车显示名 */
  bikeName: string

  /** 活动次数 */
  count: number

  /** 总距离（米） */
  totalDistance: number

  /** 总骑行时长（秒） */
  totalDuration: number

  /** 总累计爬升（米） */
  totalElevationGain: number

  /** 最近一次骑行开始时间（ISO 8601） */
  lastRideTime: string
}

/**
 * 按单车分组聚合全部活动摘要。
 *
 * @param summaries 活动摘要列表（listAllSummaries 输出，不依赖排序）
 * @returns 自行车统计条目（按活动次数降序）；空输入返回空数组
 */
export function buildBikeStats(summaries: readonly ActivitySummary[]): BikeStatsEntry[] {
  const groups = new Map<string, BikeStatsEntry>()
  for (const activity of summaries) {
    const name = activity.bikeName?.trim() || UNKNOWN_BIKE_NAME
    const entry = groups.get(name)
    if (entry === undefined) {
      groups.set(name, {
        bikeName: name,
        count: 1,
        totalDistance: activity.distance,
        totalDuration: activity.duration,
        totalElevationGain: activity.elevationGain,
        lastRideTime: activity.startTime,
      })
      continue
    }

    entry.count += 1
    entry.totalDistance += activity.distance
    entry.totalDuration += activity.duration
    entry.totalElevationGain += activity.elevationGain
    // ISO 8601 字符串字典序即时间序（与仓库排序口径一致）
    if (activity.startTime > entry.lastRideTime) {
      entry.lastRideTime = activity.startTime
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.bikeName.localeCompare(b.bikeName),
  )
}