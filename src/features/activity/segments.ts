/**
 * 分段分析（纯函数）。
 *
 * 将整条骑行按「平路 / 爬坡」切成连续分段：爬坡段复用 buildClimbs 的识别结果，
 * 坡段之间的间隙为平路段。每段统计平均速度/平均功率/平均心率/累计爬升/平均坡度，
 * 并生成相邻爬坡段的对比洞察（如「第二段比第一段平均功率高 5.4%，但速度低 21%」）。
 */
import type { ActivityRecord } from '@/types/activity'
import type { ClimbSegment } from '@/features/activity/climbs'

/** 分段类型：平路 / 爬坡 */
export type SegmentType = 'flat' | 'climb'

/** 一个骑行分段 */
export interface RideSegment {
  /** 分段类型 */
  type: SegmentType

  /** 展示名（平路段第 N 段；爬坡段为爬坡 N） */
  label: string

  /** 段起点累计距离（米） */
  startDistanceMeters: number

  /** 段终点累计距离（米） */
  endDistanceMeters: number

  /** 段距离（米） */
  distanceMeters: number

  /** 累计爬升（米） */
  elevationGain: number

  /** 平均坡度（%） */
  avgGradePercent: number

  /** 平均速度（m/s；该段无速度数据时 undefined） */
  avgSpeedMps: number | undefined

  /** 平均功率（W；该段无功率数据时 undefined） */
  avgPowerW: number | undefined

  /** 平均心率（bpm；该段无心率数据时 undefined） */
  avgHeartRateBpm: number | undefined
}

/** 相邻爬坡对比洞察 */
export interface ClimbInsight {
  /** 被比较的两段爬坡展示名 */
  fromLabel: string

  /** 被比较的后一段爬坡展示名 */
  toLabel: string

  /** 洞察文案 */
  text: string
}

/**
 * 计算一个距离区间内某指标的均值（无有效数据返回 undefined，不伪造 0）。
 *
 * @param records 逐点记录
 * @param startMeters 区间起点（米）
 * @param endMeters 区间终点（米）
 * @param field 指标字段
 * @returns 均值；无数据时 undefined
 */
function averageInRange(
  records: readonly ActivityRecord[],
  startMeters: number,
  endMeters: number,
  field: 'speed' | 'power' | 'heartRate',
): number | undefined {
  let sum = 0
  let count = 0
  for (const record of records) {
    if (record.distance === undefined || record[field] === undefined) {
      continue
    }
    if (record.distance < startMeters || record.distance > endMeters) {
      continue
    }
    sum += record[field] as number
    count += 1
  }
  return count > 0 ? sum / count : undefined
}

/**
 * 计算一个距离区间内的累计爬升（米，正增量累计）。
 *
 * @param records 逐点记录
 * @param startMeters 区间起点（米）
 * @param endMeters 区间终点（米）
 * @returns 累计爬升（米）
 */
function gainInRange(
  records: readonly ActivityRecord[],
  startMeters: number,
  endMeters: number,
): number {
  let gain = 0
  let prevAlt: number | undefined
  for (const record of records) {
    if (record.distance === undefined || record.altitude === undefined) {
      prevAlt = undefined
      continue
    }
    if (record.distance < startMeters || record.distance > endMeters) {
      continue
    }
    if (prevAlt !== undefined && record.altitude > prevAlt) {
      gain += record.altitude - prevAlt
    }
    prevAlt = record.altitude
  }
  return gain
}

/**
 * 生成整条骑行的连续分段（平路 + 爬坡交替，按距离顺序）。
 * 首段平路、坡段之间平路、末段平路；爬坡段复用识别结果，
 * 但段终点收敛到**峰值距离**（buildClimbs 的 endDistance 会把坡后平地吞进坡段）。
 *
 * @param records 逐点记录
 * @param climbs 爬坡段（buildClimbs 输出，按出现顺序）
 * @returns 按距离升序的分段列表
 */
export function buildSegments(
  records: readonly ActivityRecord[],
  climbs: readonly ClimbSegment[],
): RideSegment[] {
  const segments: RideSegment[] = []
  const totalDistance = lastDistance(records)

  // 路线起点到第一段爬坡起点之间为平路段
  const firstClimbStart = climbs[0]?.startDistanceMeters ?? totalDistance
  if (firstClimbStart > 0) {
    segments.push(makeFlatSegment(records, 0, firstClimbStart, segments.length + 1))
  }

  climbs.forEach((climb, index) => {
    // 段终点收敛到峰值距离（否则坡后平地被算进坡段，平路段缺失）
    const peakDistance = climbPeakDistance(records, climb)
    segments.push(makeClimbSegment(records, climb, peakDistance, index + 1))

    // 爬坡峰值之后到下一段爬坡起点（或路线终点）之间为平路段
    const nextStart = climbs[index + 1]?.startDistanceMeters ?? totalDistance
    const segmentEnd = nextStart > peakDistance ? nextStart : peakDistance
    if (segmentEnd - peakDistance > 1) {
      segments.push(makeFlatSegment(records, peakDistance, segmentEnd, segments.length + 1))
    }
  })

  return segments
}

/**
 * 爬坡段的海拔峰值距离（米）。
 * 在 [start, end] 区间内找海拔最高点（坡段终点收敛点）。
 *
 * @param records 逐点记录
 * @param climb 爬坡段
 * @returns 峰值距离；无海拔数据时回退段终点
 */
export function climbPeakDistance(
  records: readonly ActivityRecord[],
  climb: ClimbSegment,
): number {
  let peak = climb.endDistanceMeters
  let peakAlt = -Infinity
  for (const record of records) {
    if (record.distance === undefined || record.altitude === undefined) {
      continue
    }
    if (record.distance < climb.startDistanceMeters || record.distance > climb.endDistanceMeters) {
      continue
    }
    if (record.altitude > peakAlt) {
      peakAlt = record.altitude
      peak = record.distance
    }
  }
  return peak
}

/** 路线总距离（米，取逐点最大累计距离；无距离数据为 0） */
function lastDistance(records: readonly ActivityRecord[]): number {
  let max = 0
  for (const record of records) {
    if (record.distance !== undefined && record.distance > max) {
      max = record.distance
    }
  }
  return max
}

/**
 * 构造平路段（区间 [start, end]）。
 *
 * @param records 逐点记录
 * @param startMeters 起点（米）
 * @param endMeters 终点（米）
 * @param ordinal 平路段序号（从 1 开始，用于展示名）
 * @returns 平路段
 */
function makeFlatSegment(
  records: readonly ActivityRecord[],
  startMeters: number,
  endMeters: number,
  ordinal: number,
): RideSegment {
  const distance = endMeters - startMeters
  const gain = gainInRange(records, startMeters, endMeters)
  return {
    type: 'flat',
    label: `平路 ${ordinal}`,
    startDistanceMeters: startMeters,
    endDistanceMeters: endMeters,
    distanceMeters: distance,
    elevationGain: gain,
    avgGradePercent: distance > 0 ? (gain / distance) * 100 : 0,
    avgSpeedMps: averageInRange(records, startMeters, endMeters, 'speed'),
    avgPowerW: averageInRange(records, startMeters, endMeters, 'power'),
    avgHeartRateBpm: averageInRange(records, startMeters, endMeters, 'heartRate'),
  }
}

/**
 * 构造爬坡段（复用识别结果 + 逐点统计）。
 *
 * @param records 逐点记录
 * @param climb 爬坡段
 * @param peakDistance 爬坡段终点（峰值距离，米）
 * @param ordinal 爬坡段序号（从 1 开始，用于展示名）
 * @returns 爬坡段
 */
function makeClimbSegment(
  records: readonly ActivityRecord[],
  climb: ClimbSegment,
  peakDistance: number,
  ordinal: number,
): RideSegment {
  const distance = Math.max(peakDistance - climb.startDistanceMeters, 0)
  const gain = gainInRange(records, climb.startDistanceMeters, peakDistance)
  return {
    type: 'climb',
    label: `爬坡 ${ordinal}`,
    startDistanceMeters: climb.startDistanceMeters,
    endDistanceMeters: peakDistance,
    distanceMeters: distance,
    elevationGain: gain,
    avgGradePercent: distance > 0 ? (gain / distance) * 100 : 0,
    avgSpeedMps: averageInRange(
      records,
      climb.startDistanceMeters,
      peakDistance,
      'speed',
    ),
    avgPowerW: averageInRange(
      records,
      climb.startDistanceMeters,
      peakDistance,
      'power',
    ),
    avgHeartRateBpm: averageInRange(
      records,
      climb.startDistanceMeters,
      peakDistance,
      'heartRate',
    ),
  }
}

/**
 * 相邻爬坡段对比洞察：对每对相邻爬坡段，比较平均功率与平均速度，
 * 生成一句话洞察（如「爬坡 2 比爬坡 1 平均功率高 5.4%，但速度低 21%」）。
 * 无相邻爬坡段或无功率/速度数据时返回空数组。
 *
 * @param segments 全部分段（buildSegments 输出）
 * @returns 洞察列表（按爬坡顺序）
 */
export function climbInsights(segments: readonly RideSegment[]): ClimbInsight[] {
  const climbs = segments.filter((segment) => segment.type === 'climb')
  const insights: ClimbInsight[] = []
  for (let index = 0; index + 1 < climbs.length; index++) {
    const from = climbs[index]
    const to = climbs[index + 1]
    const text = compareTwoClimbs(from, to)
    if (text !== null) {
      insights.push({ fromLabel: from.label, toLabel: to.label, text })
    }
  }
  return insights
}

/**
 * 比较两段爬坡，生成一句话洞察。
 *
 * @param from 前一段爬坡
 * @param to 后一段爬坡
 * @returns 洞察文案；无可比较指标时 null
 */
function compareTwoClimbs(from: RideSegment, to: RideSegment): string | null {
  const parts: string[] = []

  // 平均功率对比（双方均有功率数据时）
  if (from.avgPowerW !== undefined && to.avgPowerW !== undefined) {
    const change = percentChange(from.avgPowerW, to.avgPowerW, '平均功率')
    if (change !== null) {
      parts.push(change)
    }
  }

  // 平均速度对比（双方均有速度数据时）
  if (from.avgSpeedMps !== undefined && to.avgSpeedMps !== undefined) {
    const change = percentChange(from.avgSpeedMps, to.avgSpeedMps, '速度')
    if (change !== null) {
      parts.push(change)
    }
  }

  if (parts.length === 0) {
    return null
  }
  const joined = parts.length === 2 ? `${parts[0]}，但${parts[1]}` : parts[0]
  return `${to.label}比${from.label}${joined}`
}

/**
 * 单项指标的百分比变化文案。
 *
 * @param fromValue 前一段取值
 * @param toValue 后一段取值
 * @param label 指标名（平均功率/速度）
 * @returns 文案片段（如「平均功率高 5.4%」/「速度低 21%」）；差异过小或无意义时 null
 */
function percentChange(
  fromValue: number,
  toValue: number,
  label: string,
): string | null {
  if (fromValue === 0) {
    return null
  }
  const ratio = (toValue - fromValue) / fromValue
  const percent = Math.abs(ratio) * 100
  if (percent < 0.5) {
    return null
  }
  if (ratio > 0) {
    return `${label}高 ${percent.toFixed(1)}%`
  }
  return `${label}低 ${percent.toFixed(1)}%`
}