/**
 * 设备统计聚合纯函数（规格 §39 P2）。
 *
 * 输入 listAllSummaries() 输出的摘要列表，按设备分组聚合：
 * 活动次数、总距离、总时长、总爬升与最近一次骑行时间。
 *
 * 设备显示名规则：优先产品名（productName），缺失回退型号（product），
 * 再缺失回退制造商（manufacturer），三者全缺失（或仅空白字符串）归「未知设备」组。
 * 结果按活动次数降序，次数相同按显示名升序（保证输出稳定）。
 * 全时段口径，与统计页范围选择无关。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import type { DeviceInfo } from '@/types/activity'

/** 无设备信息活动的归组显示名 */
export const UNKNOWN_DEVICE_NAME = '未知设备'

/**
 * 设备统计条目。
 */
export interface DeviceStatsEntry {
  /** 设备显示名（产品名/型号/制造商回退链，或未知设备） */
  deviceName: string

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
 * 按设备分组聚合全部活动摘要。
 *
 * @param summaries 活动摘要列表（listAllSummaries 输出，不依赖排序）
 * @returns 设备统计条目（按活动次数降序）；空输入返回空数组
 */
export function buildDeviceStats(summaries: readonly ActivitySummary[]): DeviceStatsEntry[] {
  const groups = new Map<string, DeviceStatsEntry>()
  for (const activity of summaries) {
    const name = resolveDeviceName(activity.device)
    const entry = groups.get(name)
    if (entry === undefined) {
      groups.set(name, {
        deviceName: name,
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
    (a, b) => b.count - a.count || a.deviceName.localeCompare(b.deviceName),
  )
}

/**
 * 解析设备显示名：产品名 → 型号 → 制造商 → 未知设备。
 *
 * @param device 设备信息（可缺失）
 * @returns 设备显示名
 */
function resolveDeviceName(device: DeviceInfo | undefined): string {
  if (device === undefined) {
    return UNKNOWN_DEVICE_NAME
  }
  return (
    firstNonBlank(device.productName, device.product, device.manufacturer) ?? UNKNOWN_DEVICE_NAME
  )
}

/**
 * 返回首个非空白字符串（去除首尾空白后非空）。
 *
 * @param candidates 候选字符串
 * @returns 首个有效值，全部缺失/空白时 undefined
 */
function firstNonBlank(...candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return undefined
}
