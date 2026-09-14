/**
 * 赛段穿越窗口指标计算（纯函数）。
 *
 * 在一次穿越窗口（计时起点 → 完赛点）内计算均速 / 均功率 / 均心率，
 * 供成绩落库（segment_efforts）与赛段详情页历史成绩表展示。
 *
 * 口径：
 * - 均速 = 窗口内 GPS 相邻点 haversine 距离累加 / 窗口用时（真实骑行路径，
 *   区别于活动整体均速；无 GPS 或用时 ≤ 0 时 undefined）；
 * - 均功率 / 均心率 = 窗口内该字段有值记录的算术平均（无传感器数据 → undefined，
 *   遵循全站「缺失 = undefined ≠ 0」口径，不把缺数据伪装成 0）。
 */
import type { ActivityRecord } from '@/types/activity'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 穿越窗口指标（字段缺失为 undefined，不伪造 0） */
export interface EffortMetrics {
  /** 窗口平均速度（m/s） */
  avgSpeed?: number

  /** 窗口平均功率（W） */
  avgPower?: number

  /** 窗口平均心率（bpm） */
  avgHeartRate?: number
}

/**
 * 计算穿越窗口内的均速 / 均功率 / 均心率。
 *
 * @param records 完整逐点数据（按时间升序）
 * @param startTimestamp 计时起点（Unix 秒，含）
 * @param endTimestamp 完赛点时间戳（Unix 秒，含）
 * @returns 指标集合（各字段独立判定缺失）
 */
export function computeEffortMetrics(
  records: readonly ActivityRecord[],
  startTimestamp: number,
  endTimestamp: number,
): EffortMetrics {
  const durationSeconds = endTimestamp - startTimestamp

  // 均速：窗口内 GPS 相邻点距离累加 / 用时
  let pathMeters = 0
  let previous: { latitude: number; longitude: number } | undefined
  let powerSum = 0
  let powerCount = 0
  let heartRateSum = 0
  let heartRateCount = 0

  for (const record of records) {
    if (record.timestamp < startTimestamp || record.timestamp > endTimestamp) {
      continue
    }
    const hasPosition =
      record.latitude !== undefined && record.longitude !== undefined
    if (hasPosition) {
      const current = { latitude: record.latitude!, longitude: record.longitude! }
      if (previous !== undefined) {
        pathMeters += haversineMeters(previous, current)
      }
      previous = current
    }
    if (record.power !== undefined) {
      powerSum += record.power
      powerCount += 1
    }
    if (record.heartRate !== undefined) {
      heartRateSum += record.heartRate
      heartRateCount += 1
    }
  }

  return {
    avgSpeed:
      durationSeconds > 0 && pathMeters > 0 ? pathMeters / durationSeconds : undefined,
    avgPower: powerCount > 0 ? powerSum / powerCount : undefined,
    avgHeartRate: heartRateCount > 0 ? heartRateSum / heartRateCount : undefined,
  }
}
