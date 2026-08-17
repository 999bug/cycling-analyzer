/**
 * 个人纪录（PR）聚合（规格 §39 P2）。
 *
 * 两类纪录：
 * - 骑行纪录：最远距离 / 最长时长 / 最多爬升（来自活动摘要，全时段）
 * - 功率纪录：各标准时长最佳平均功率（合并全部活动的功率曲线）
 *
 * 并列规则：严格大于才替换，保留最早达成的活动。
 * 所有纪录均来自真实数据，无数据类型不出现在结果中（不伪造，规格 §25）。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import type { PowerCurvePoint } from '@/features/analysis/powerCurve'

/** 功率纪录标准时长（秒）：5s / 1min / 5min / 20min（经典 PR 四档） */
export const POWER_RECORD_DURATIONS: readonly number[] = [5, 60, 300, 1200]

/**
 * 骑行纪录项。
 */
export interface RideRecordEntry {
  /** 纪录类型键 */
  key: 'distance' | 'duration' | 'elevationGain'

  /** 纪录数值（单位与领域模型一致：米 / 秒 / 米） */
  value: number

  /** 达成活动 ID（跳转详情） */
  activityId: string

  /** 达成活动开始时间（ISO 8601） */
  startTime: string
}

/**
 * 功率纪录项。
 */
export interface PowerRecordEntry {
  /** 时长（秒） */
  duration: number

  /** 该时长最佳平均功率（W） */
  power: number

  /** 达成活动 ID（跳转详情） */
  activityId: string

  /** 达成活动开始时间（ISO 8601） */
  startTime: string
}

/**
 * 单次活动的功率曲线（合并功率纪录的输入）。
 */
export interface ActivityPowerCurve {
  /** 活动摘要（提供 ID 与时间） */
  activity: ActivitySummary

  /** 该活动的功率曲线（buildPowerCurve 输出） */
  curve: readonly PowerCurvePoint[]
}

/**
 * 从全部活动摘要提取骑行纪录（最远距离 / 最长时长 / 最多爬升）。
 *
 * @param summaries 全部活动摘要（不依赖排序）
 * @returns 三项纪录（有活动则恒为 3 项）
 */
export function buildRideRecords(summaries: readonly ActivitySummary[]): RideRecordEntry[] {
  const records = new Map<RideRecordEntry['key'], RideRecordEntry>()
  for (const activity of summaries) {
    collect(records, 'distance', activity.distance, activity)
    collect(records, 'duration', activity.duration, activity)
    collect(records, 'elevationGain', activity.elevationGain, activity)
  }
  return [...records.values()]
}

/**
 * 合并全部活动的功率曲线，取每个时长的最佳平均功率。
 *
 * @param items 各活动功率曲线
 * @returns 功率纪录（按时长升序）；无任何功率数据时为空数组
 */
export function buildPowerRecords(items: readonly ActivityPowerCurve[]): PowerRecordEntry[] {
  const best = new Map<number, PowerRecordEntry>()
  for (const { activity, curve } of items) {
    for (const point of curve) {
      const current = best.get(point.duration)
      if (current === undefined || point.power > current.power) {
        best.set(point.duration, {
          duration: point.duration,
          power: point.power,
          activityId: activity.id,
          startTime: activity.startTime,
        })
      }
    }
  }
  return [...best.values()].sort((a, b) => a.duration - b.duration)
}

/**
 * 单项纪录取最大：严格大于才替换（并列保留最早达成者）。
 *
 * @param records 纪录累积表
 * @param key 纪录类型
 * @param value 本次活动数值
 * @param activity 活动摘要
 */
function collect(
  records: Map<RideRecordEntry['key'], RideRecordEntry>,
  key: RideRecordEntry['key'],
  value: number,
  activity: ActivitySummary,
): void {
  const current = records.get(key)
  if (current === undefined || value > current.value) {
    records.set(key, { key, value, activityId: activity.id, startTime: activity.startTime })
  }
}
