/**
 * 心率/功率训练区间分布计算（规格 §26）。
 *
 * 经典 5 区间划分：
 * - 心率区间（按最大心率百分比）：Z1 <60%、Z2 60-70%、Z3 70-80%、Z4 80-90%、Z5 ≥90%
 * - 功率区间（按 FTP 百分比）：Z1 <55%、Z2 55-75%、Z3 75-90%、Z4 90-105%、Z5 ≥105%
 *
 * 分布按相邻记录时间间隔累计（首点无前驱不计），缺失指标值的记录跳过。
 * 边界归属：恰好落在边界上归入更高区间（如恰好 60% 最大心率归 Z2）。
 *
 * 配置（最大心率/FTP）缺失或无效时返回 null，不伪造计算（规格 §26）。
 */
import type { ActivityRecord } from '../../types/activity'

/**
 * 区间分布条目。
 */
export interface ZoneDistribution {
  /** 区间编号（1-5） */
  zone: number

  /** 累计时长（秒） */
  seconds: number

  /** 占总有效时长的百分比（0-100） */
  percent: number
}

/** 心率区间边界（最大心率百分比）：Z1 <60%、Z2 60-70%、Z3 70-80%、Z4 80-90%、Z5 ≥90% */
const HEART_RATE_ZONE_BOUNDS: readonly number[] = [0.6, 0.7, 0.8, 0.9]

/** 功率区间边界（FTP 百分比）：Z1 <55%、Z2 55-75%、Z3 75-90%、Z4 90-105%、Z5 ≥105% */
const POWER_ZONE_BOUNDS: readonly number[] = [0.55, 0.75, 0.9, 1.05]

/** 训练区间数量（1-5） */
const ZONE_COUNT = 5

/**
 * 将阈值比率归入区间编号：比率小于第 i 个边界归 i 号，否则归最大号。
 *
 * @param ratio 指标值相对阈值基线的比率（如 心率/最大心率）
 * @param bounds 区间边界（升序）
 * @returns 区间编号（1 至 bounds.length + 1）
 */
function zoneIndexOf(ratio: number, bounds: readonly number[]): number {
  for (let i = 0; i < bounds.length; i++) {
    if (ratio < bounds[i]) {
      return i + 1
    }
  }
  return bounds.length + 1
}

/**
 * 通用区间分布计算：每段时长（当前记录与前驱的时间差）归入当前记录的
 * 指标值所在区间；首点无前驱、指标缺失、时间未推进的记录不计入。
 *
 * @param records 逐点记录
 * @param valueOf 取记录指标值（缺失返回 undefined）
 * @param ratioOf 指标值 → 阈值比率（如 心率/最大心率）
 * @param bounds 区间边界
 * @returns 5 个区间分布（按 1-5 顺序，无有效数据时各区间为 0）
 */
function calculateDistribution(
  records: readonly ActivityRecord[],
  valueOf: (record: ActivityRecord) => number | undefined,
  ratioOf: (value: number) => number,
  bounds: readonly number[],
): ZoneDistribution[] {
  const secondsByZone = new Array<number>(ZONE_COUNT).fill(0)
  for (let i = 1; i < records.length; i++) {
    const value = valueOf(records[i])
    if (value === undefined) {
      continue
    }
    const duration = records[i].timestamp - records[i - 1].timestamp
    if (duration <= 0) {
      continue
    }
    secondsByZone[zoneIndexOf(ratioOf(value), bounds) - 1] += duration
  }
  const total = secondsByZone.reduce((sum, seconds) => sum + seconds, 0)
  return Array.from({ length: ZONE_COUNT }, (_, index) => ({
    zone: index + 1,
    seconds: secondsByZone[index],
    percent: total > 0 ? (secondsByZone[index] / total) * 100 : 0,
  }))
}

/**
 * 计算心率区间分布（按最大心率百分比）。
 *
 * @param records 逐点记录
 * @param maxHeartRate 用户最大心率（bpm），未配置或无效时返回 null
 * @returns 5 个区间分布；最大心率未配置/无效时 null
 */
export function calculateHeartRateZones(
  records: readonly ActivityRecord[],
  maxHeartRate: number | undefined,
): ZoneDistribution[] | null {
  if (typeof maxHeartRate !== 'number' || !Number.isFinite(maxHeartRate) || maxHeartRate <= 0) {
    return null
  }
  return calculateDistribution(
    records,
    (record) => record.heartRate,
    (value) => value / maxHeartRate,
    HEART_RATE_ZONE_BOUNDS,
  )
}

/**
 * 计算功率区间分布（按 FTP 百分比）。
 *
 * @param records 逐点记录
 * @param ftp 用户功能阈值功率（W），未配置或无效时返回 null
 * @returns 5 个区间分布；FTP 未配置/无效时 null
 */
export function calculatePowerZones(
  records: readonly ActivityRecord[],
  ftp: number | undefined,
): ZoneDistribution[] | null {
  if (typeof ftp !== 'number' || !Number.isFinite(ftp) || ftp <= 0) {
    return null
  }
  return calculateDistribution(
    records,
    (record) => record.power,
    (value) => value / ftp,
    POWER_ZONE_BOUNDS,
  )
}
