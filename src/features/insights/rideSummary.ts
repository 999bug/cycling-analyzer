/**
 * 骑行一句话总结（纯函数，UI-2 / 评审 P0-01）。
 *
 * 推断骑行类型（长距离/爬坡/恢复/耐力/节奏/高强度）并拼装
 * 「全程多少公里、骑多久、爬升多少」的首屏总结文案，
 * 让用户 5 秒内回答"骑多久、多少公里、骑得怎么样"。
 *
 * 全部由真实数据条件生成（严禁写死文案）；距离与时长均缺失时
 * 返回 undefined（不伪造，规格 §25 同源原则）。
 */
import type { Activity } from '@/types/activity'
import {
  intensityTierByHeartRate,
  intensityTierByPower,
} from '@/features/insights/rideInsights'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'
import { formatDurationText } from '@/utils/format'

/** 骑行一句话总结 */
export interface RideSummary {
  /** 骑行类型标签（长距离/爬坡/恢复骑/耐力骑/节奏骑/高强度） */
  rideType: string

  /** 一句话总结（含真实数值；数据缺失的分句自动省略） */
  headline: string

  /** 质量档位短语（如「状态出色」；无质量分时 undefined） */
  qualityPhrase: string | undefined
}

/** 总结计算参数 */
export interface RideSummaryOptions {
  /** FTP（W）：强度类型推断依据 */
  ftp?: number

  /** 最大心率（bpm）：无 FTP 时的强度推断依据 */
  maxHeartRate?: number

  /** 距离显示单位（默认 km，规格 §27） */
  distanceUnit?: DistanceUnit

  /** 骑行质量综合分（0-100；无数据时省略档位短语） */
  qualityScore?: number
}

/** 长距离骑行判定（米），与 rideInsights 阈值一致 */
const LONG_RIDE_METERS = 80_000

/** 爬坡日判定（米/公里），与 rideInsights 阈值一致 */
const CLIMB_HEAVY_M_PER_KM = 15

/**
 * 生成骑行一句话总结。
 *
 * @param activity 活动摘要
 * @param options 计算参数（FTP/最大心率/单位/质量分）
 * @returns 总结；距离与时长均缺失时 undefined
 */
export function buildRideSummary(activity: Activity, options: RideSummaryOptions = {}): RideSummary | undefined {
  const unit = options.distanceUnit ?? 'km'
  const hasDistance = activity.distance !== undefined && activity.distance > 0
  const hasDuration = activity.duration > 0
  if (!hasDistance && !hasDuration) {
    return undefined
  }

  const rideType = inferRideType(activity, options)

  const parts: string[] = []
  if (hasDistance) {
    parts.push(`全程 ${formatDistanceByUnit(activity.distance, unit)}`)
  }
  if (hasDuration) {
    parts.push(`骑行 ${formatDurationText(activity.duration)}`)
  }
  if (activity.elevationGain !== undefined && activity.elevationGain > 0) {
    parts.push(`爬升 ${Math.round(activity.elevationGain)} 米`)
  }
  if (activity.avgSpeed !== undefined && activity.avgSpeed > 0) {
    parts.push(`均速 ${formatSpeedByUnit(activity.avgSpeed, unit)}`)
  }

  return {
    rideType,
    headline: parts.join('，'),
    qualityPhrase: qualityTierPhrase(options.qualityScore),
  }
}

/**
 * 骑行类型推断（优先级：长距离 > 爬坡 > 强度档位）。
 *
 * @param activity 活动摘要
 * @param options 含 FTP/最大心率
 * @returns 类型标签
 */
function inferRideType(activity: Activity, options: RideSummaryOptions): string {
  if (activity.distance !== undefined && activity.distance >= LONG_RIDE_METERS) {
    return '长距离'
  }
  if (
    activity.elevationGain !== undefined &&
    activity.distance !== undefined &&
    activity.distance > 0 &&
    activity.elevationGain / (activity.distance / 1000) >= CLIMB_HEAVY_M_PER_KM
  ) {
    return '爬坡'
  }

  const ftp = options.ftp
  if (ftp !== undefined && ftp > 0) {
    const power = activity.normalizedPower ?? activity.avgPower
    if (power !== undefined && power > 0) {
      return intensityTierByPower(power / ftp).label
    }
  }
  const maxHeartRate = options.maxHeartRate
  if (maxHeartRate !== undefined && maxHeartRate > 0 && activity.avgHeartRate !== undefined) {
    return intensityTierByHeartRate(activity.avgHeartRate / maxHeartRate).label
  }

  // 无强度依据：按时长粗分（不伪造强度结论）
  if (activity.duration >= 5400) {
    return '长骑行'
  }
  return '骑行'
}

/**
 * 质量档位短语：取综合评价文案冒号前的短评（与 QualityScoreSection 档位一致）。
 *
 * @param score 综合分（0-100）
 * @returns 如「状态出色」；无分时 undefined
 */
function qualityTierPhrase(score: number | undefined): string | undefined {
  if (score === undefined) {
    return undefined
  }
  if (score >= 85) {
    return '状态出色'
  }
  if (score >= 70) {
    return '表现良好'
  }
  if (score >= 55) {
    return '表现平稳'
  }
  return '有待提升'
}

/**
 * 时长口语化文案：'2 小时 15 分钟' / '48 分钟' / '36 秒'。
 *
 * @param seconds 时长（秒）
 * @returns 文案
 */
// formatDurationText 抽到 @/utils/format 共享，避免两处重复实现
