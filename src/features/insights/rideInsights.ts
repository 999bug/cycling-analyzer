/**
 * 动态骑行洞察（纯函数，UI-1 / 评审 P0-02）。
 *
 * 把一次骑行的真实数据转译为 3~5 条自然语言洞察：
 * - 强度档位（IF 或心率占比，恢复/耐力/节奏/阈值以上）
 * - 后程衰减（前 30% vs 后 30% 距离段平均速度）
 * - 心率漂移（前后半程功率/心率比下降 = 有氧解耦）
 * - 爬坡负荷（每公里爬升）与主要爬坡（UCI 分级）
 * - 长距离、配速稳定性、极速、GPS 漂移
 *
 * 所有文案均由实际数据条件生成（严禁写死示例文案）；
 * 洞察不足 3 条时以「距离/时长/爬升/均速」概览兜底（同样是真实数据）；
 * 数据全部缺失时返回空数组（不伪造，规格 §25/§26 同源原则）。
 */
import type { Activity, ActivityRecord } from '@/types/activity'
import { buildClimbs, uciCategory } from '@/features/activity/climbs'
import { cleanTrackDrift } from '@/features/activity/trackCleanup'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'

/** 洞察语气类型（决定展示层配色/图标语义） */
export type InsightKind = 'positive' | 'negative' | 'info'

/** 单条骑行洞察 */
export interface RideInsight {
  /** 洞察 key（规则标识，组件渲染 key） */
  key: string

  /** 语气类型 */
  kind: InsightKind

  /** 洞察标题（短语） */
  title: string

  /** 洞察正文（含具体数值的自然语言） */
  text: string
}

/** 洞察计算可选参数 */
export interface RideInsightsOptions {
  /** FTP（W）：有功率数据时用于强度分档（IF） */
  ftp?: number

  /** 最大心率（bpm）：无 FTP 时的强度分档依据 */
  maxHeartRate?: number

  /** 距离显示单位（默认 km，规格 §27） */
  distanceUnit?: DistanceUnit
}

/** 输出洞察条数上限（评审 P0-02：3~5 条） */
const MAX_INSIGHTS = 5

/** 兜底洞察条数下限 */
const MIN_INSIGHTS = 3

/** 后程衰减判定：前 30% vs 后 30% 距离段 */
const FADE_EDGE_RATIO = 0.3

/** 后程衰减阈值（%）：后段速度较前段下降超过该值判定为明显掉速 */
const FADE_DROP_PERCENT = 8

/** 负分段阈值（%）：后段速度较前段提升超过该值判定为越骑越快 */
const FADE_IMPROVE_PERCENT = 3

/** 心率漂移阈值（%）：后半程功率/心率比较前半程下降超过该值判定为有氧解耦 */
const DRIFT_DECOUPLE_PERCENT = 10

/** 爬坡日判定（米/公里）：每公里爬升超过该值为山地负荷 */
const CLIMB_HEAVY_M_PER_KM = 15

/** 起伏路判定（米/公里）：每公里爬升超过该值为明显起伏 */
const CLIMB_ROLLY_M_PER_KM = 8

/** 长距离骑行判定（米） */
const LONG_RIDE_METERS = 80_000

/** 配速稳定判定：速度变异系数 ≤ 该值 */
const STEADY_PACE_CV = 0.08

/** 配速波动判定：速度变异系数 ≥ 该值 */
const ERRATIC_PACE_CV = 0.25

/** 变异系数最小样本数 */
const MIN_CV_SAMPLES = 10

/** 极速洞察阈值（m/s，约 60 km/h） */
const TOP_SPEED_MPS = 60 / 3.6

/** 变异系数类洞察的展示精度（百分数） */
const CV_PERCENT_PRECISION = 0

/**
 * 生成骑行洞察。
 *
 * @param activity 活动摘要（距离/时长/爬升/功率/心率等）
 * @param records 逐点记录（可空数组：仅靠摘要生成概览兜底）
 * @param options 可选参数（FTP/最大心率/距离单位）
 * @returns 洞察列表（按 负面 → 正面 → 中性 排序，上限 5 条；数据全缺时为空）
 */
export function buildRideInsights(
  activity: Activity,
  records: readonly ActivityRecord[],
  options: RideInsightsOptions = {},
): RideInsight[] {
  const unit = options.distanceUnit ?? 'km'
  const insights: RideInsight[] = [
    intensityInsight(activity, options),
    fadeInsight(records, unit),
    cardiacDriftInsight(records),
    climbingInsight(activity, records, unit),
    longRideInsight(activity, unit),
    steadyPaceInsight(records),
    topSpeedInsight(activity, unit),
    gpsQualityInsight(records),
  ].filter((insight): insight is RideInsight => insight !== undefined)

  // 洞察不足下限时用真实数据概览兜底（仍非写死文案）
  if (insights.length < MIN_INSIGHTS) {
    const overview = overviewInsight(activity, unit)
    if (overview !== undefined) {
      insights.unshift(overview)
    }
  }

  // 排序：负面最先（用户最该知道的问题），其次正面，最后中性；截断上限
  const priority: Record<InsightKind, number> = { negative: 0, positive: 1, info: 2 }
  return insights
    .sort((a, b) => priority[a.kind] - priority[b.kind])
    .slice(0, MAX_INSIGHTS)
}

/**
 * 强度档位洞察：优先用 IF（NP 或平均功率 ÷ FTP），无 FTP 退化为心率占比。
 *
 * @param activity 活动摘要
 * @param options 含 FTP/最大心率
 * @returns 洞察；数据不足时 undefined
 */
function intensityInsight(activity: Activity, options: RideInsightsOptions): RideInsight | undefined {
  const ftp = options.ftp
  if (ftp !== undefined && ftp > 0) {
    const power = activity.normalizedPower ?? activity.avgPower
    if (power !== undefined && power > 0) {
      const ratio = power / ftp
      const { label, note } = intensityTierByPower(ratio)
      return {
        key: 'intensity',
        kind: 'info',
        title: '强度档位',
        text: `输出约为 FTP 的 ${Math.round(ratio * 100)}%，${label}（${note}）`,
      }
    }
  }

  const maxHeartRate = options.maxHeartRate
  if (maxHeartRate !== undefined && maxHeartRate > 0 && activity.avgHeartRate !== undefined) {
    const ratio = activity.avgHeartRate / maxHeartRate
    const { label, note } = intensityTierByHeartRate(ratio)
    return {
      key: 'intensity',
      kind: 'info',
      title: '强度档位',
      text: `平均心率达最大心率的 ${Math.round(ratio * 100)}%，${label}（${note}）`,
    }
  }
  return undefined
}

/** 功率强度档位（按占 FTP 比例） */
function intensityTierByPower(ratio: number): { label: string; note: string } {
  if (ratio < 0.55) {
    return { label: '恢复骑', note: '主动恢复强度的轻松骑行' }
  }
  if (ratio < 0.75) {
    return { label: '耐力骑', note: '有氧耐力区间，可长时间维持' }
  }
  if (ratio < 0.95) {
    return { label: '节奏骑', note: '接近阈值的稳定输出，训练刺激较强' }
  }
  return { label: '高强度', note: '达到或超过阈值，负荷很大' }
}

/** 心率强度档位（按占最大心率比例） */
function intensityTierByHeartRate(ratio: number): { label: string; note: string } {
  if (ratio < 0.65) {
    return { label: '恢复骑', note: '心率偏低，属轻松恢复强度' }
  }
  if (ratio < 0.75) {
    return { label: '耐力骑', note: '有氧耐力区间，可长时间维持' }
  }
  if (ratio < 0.85) {
    return { label: '有氧骑', note: '中高强度有氧区间' }
  }
  return { label: '阈值强度', note: '心率很高，负荷接近阈值' }
}

/**
 * 后程衰减洞察：前 30% vs 后 30% 距离段的平均速度对比。
 *
 * @param records 逐点记录
 * @param unit 距离显示单位
 * @returns 洞察；速度/距离数据不足时 undefined
 */
function fadeInsight(records: readonly ActivityRecord[], unit: DistanceUnit): RideInsight | undefined {
  const maxDistance = maxRecordDistance(records)
  if (maxDistance === undefined || maxDistance === 0) {
    return undefined
  }

  const frontStart = 0
  const frontEnd = maxDistance * FADE_EDGE_RATIO
  const backStart = maxDistance * (1 - FADE_EDGE_RATIO)
  const frontSpeed = averageFieldInRange(records, 'speed', frontStart, frontEnd)
  const backSpeed = averageFieldInRange(records, 'speed', backStart, Number.POSITIVE_INFINITY)
  if (frontSpeed === undefined || backSpeed === undefined || frontSpeed === 0) {
    return undefined
  }

  const changePercent = ((backSpeed - frontSpeed) / frontSpeed) * 100
  if (changePercent <= -FADE_DROP_PERCENT) {
    return {
      key: 'fade',
      kind: 'negative',
      title: '后程衰减',
      text: `后段平均速度较前段下降 ${Math.abs(changePercent).toFixed(1)}%（${formatSpeedByUnit(frontSpeed, unit)} → ${formatSpeedByUnit(backSpeed, unit)}），体力分配前松后紧`,
    }
  }
  if (changePercent >= FADE_IMPROVE_PERCENT) {
    return {
      key: 'fade',
      kind: 'positive',
      title: '负分段',
      text: `后段平均速度较前段提升 ${changePercent.toFixed(1)}%（${formatSpeedByUnit(frontSpeed, unit)} → ${formatSpeedByUnit(backSpeed, unit)}），后程发力出色`,
    }
  }
  return undefined
}

/**
 * 心率漂移洞察：前后半程「平均功率/平均心率」比值变化（有氧解耦，EF 口径）。
 *
 * @param records 逐点记录
 * @returns 洞察；功率或心率数据不足时 undefined
 */
function cardiacDriftInsight(records: readonly ActivityRecord[]): RideInsight | undefined {
  const maxDistance = maxRecordDistance(records)
  if (maxDistance === undefined || maxDistance === 0) {
    return undefined
  }

  const midpoint = maxDistance * 0.5
  const front = halfEfficiency(records, 0, midpoint)
  const back = halfEfficiency(records, midpoint, Number.POSITIVE_INFINITY)
  if (front === undefined || back === undefined || front === 0) {
    return undefined
  }

  const declinePercent = ((front - back) / front) * 100
  if (declinePercent >= DRIFT_DECOUPLE_PERCENT) {
    return {
      key: 'cardiacDrift',
      kind: 'negative',
      title: '心率漂移',
      text: `后半程同等功率下心率升高（效率下降 ${declinePercent.toFixed(1)}%），存在有氧解耦，建议关注补给与耐热`,
    }
  }
  return undefined
}

/**
 * 爬坡负荷洞察：每公里爬升 + 主要爬坡段（UCI 分级）。
 *
 * @param activity 活动摘要
 * @param records 逐点记录
 * @param unit 距离显示单位
 * @returns 洞察；无爬升数据时 undefined
 */
function climbingInsight(
  activity: Activity,
  records: readonly ActivityRecord[],
  unit: DistanceUnit,
): RideInsight | undefined {
  const gain = activity.elevationGain
  const distance = activity.distance
  if (gain === undefined || distance === undefined || distance === 0 || gain <= 0) {
    return undefined
  }

  const metersPerKm = gain / (distance / 1000)
  let insight: RideInsight | undefined

  if (metersPerKm >= CLIMB_HEAVY_M_PER_KM) {
    insight = {
      key: 'climbing',
      kind: 'info',
      title: '爬坡日',
      text: `每公里爬升 ${Math.round(metersPerKm)} 米（累计 ${Math.round(gain)} 米），属山地负荷，腿部消耗大`,
    }
  } else if (metersPerKm >= CLIMB_ROLLY_M_PER_KM) {
    insight = {
      key: 'climbing',
      kind: 'info',
      title: '起伏路线',
      text: `每公里爬升 ${Math.round(metersPerKm)} 米（累计 ${Math.round(gain)} 米），路线起伏明显`,
    }
  }
  if (insight !== undefined) {
    return insight
  }

  // 负荷不显著时仍可报告主要爬坡（UCI 分级坡值得单独一提）
  const mainClimb = buildClimbs(records).reduce<ClimbLike | undefined>(
    (best, climb) => (best === undefined || climb.distanceMeters > best.distanceMeters ? climb : best),
    undefined,
  )
  if (mainClimb !== undefined) {
    const category = uciCategory(mainClimb.distanceMeters, mainClimb.avgGradePercent)
    if (category !== null) {
      return {
        key: 'climbing',
        kind: 'info',
        title: '主要爬坡',
        text: `包含一段 ${formatDistanceByUnit(mainClimb.distanceMeters, unit)}、平均坡度 ${mainClimb.avgGradePercent.toFixed(1)}% 的爬坡（${formatUciCategory(category)}）`,
      }
    }
  }
  return undefined
}

/** buildClimbs 返回结构的最小子集（避免整接口耦合） */
interface ClimbLike {
  distanceMeters: number
  avgGradePercent: number
}

/** UCI 坡级展示文案 */
function formatUciCategory(category: 'HC' | 1 | 2 | 3 | 4): string {
  return category === 'HC' ? 'HC 级（超越级爬坡）' : `${category} 级坡`
}

/**
 * 长距离骑行洞察。
 *
 * @param activity 活动摘要
 * @param unit 距离显示单位
 * @returns 洞察；距离不足时 undefined
 */
function longRideInsight(activity: Activity, unit: DistanceUnit): RideInsight | undefined {
  if (activity.distance === undefined || activity.distance < LONG_RIDE_METERS) {
    return undefined
  }
  return {
    key: 'longRide',
    kind: 'info',
    title: '长距离骑行',
    text: `全程 ${formatDistanceByUnit(activity.distance, unit)}，达到长距离级别，注意补给与恢复`,
  }
}

/**
 * 配速稳定性洞察：速度变异系数（CV）。
 *
 * @param records 逐点记录
 * @returns 洞察；速度样本不足时 undefined
 */
function steadyPaceInsight(records: readonly ActivityRecord[]): RideInsight | undefined {
  const values = records
    .map((record) => record.speed)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (values.length < MIN_CV_SAMPLES) {
    return undefined
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean === 0) {
    return undefined
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const cv = Math.sqrt(variance) / mean
  const cvPercent = (cv * 100).toFixed(CV_PERCENT_PRECISION)

  if (cv <= STEADY_PACE_CV) {
    return {
      key: 'steadyPace',
      kind: 'positive',
      title: '配速稳定',
      text: `速度波动极小（CV ${cvPercent}%），节奏控制出色`,
    }
  }
  if (cv >= ERRATIC_PACE_CV) {
    return {
      key: 'steadyPace',
      kind: 'negative',
      title: '配速波动',
      text: `速度波动明显（CV ${cvPercent}%），可能含频繁启停或间歇冲刺`,
    }
  }
  return undefined
}

/**
 * 极速洞察（下坡/冲刺）。
 *
 * @param activity 活动摘要
 * @param unit 距离显示单位（决定速度单位）
 * @returns 洞察；极速不足时 undefined
 */
function topSpeedInsight(activity: Activity, unit: DistanceUnit): RideInsight | undefined {
  if (activity.maxSpeed === undefined || activity.maxSpeed < TOP_SPEED_MPS) {
    return undefined
  }
  return {
    key: 'topSpeed',
    kind: 'info',
    title: '极速',
    text: `最高速度达 ${formatSpeedByUnit(activity.maxSpeed, unit)}，注意下坡控车安全`,
  }
}

/**
 * GPS 质量洞察：复用轨迹纠偏的漂移点计数。
 *
 * @param records 逐点记录
 * @returns 洞察；无漂移点时 undefined
 */
function gpsQualityInsight(records: readonly ActivityRecord[]): RideInsight | undefined {
  if (records.length === 0) {
    return undefined
  }
  const removedCount = cleanTrackDrift(records).removedCount
  if (removedCount === 0) {
    return undefined
  }
  return {
    key: 'gpsQuality',
    kind: 'info',
    title: 'GPS 数据质量',
    text: `检测到 ${removedCount} 个 GPS 漂移点，已在轨迹展示与导出中剔除`,
  }
}

/**
 * 概览兜底洞察：距离/时长/爬升/均速的真实数据描述。
 *
 * @param activity 活动摘要
 * @param unit 距离显示单位
 * @returns 洞察；距离与时长均缺失时 undefined
 */
function overviewInsight(activity: Activity, unit: DistanceUnit): RideInsight | undefined {
  if ((activity.distance === undefined || activity.distance === 0) && activity.duration <= 0) {
    return undefined
  }

  const parts: string[] = []
  if (activity.distance !== undefined && activity.distance > 0) {
    parts.push(`全程 ${formatDistanceByUnit(activity.distance, unit)}`)
  }
  if (activity.duration > 0) {
    parts.push(`骑行 ${formatDurationText(activity.duration)}`)
  }
  if (activity.elevationGain !== undefined && activity.elevationGain > 0) {
    parts.push(`爬升 ${Math.round(activity.elevationGain)} 米`)
  }
  if (activity.avgSpeed !== undefined && activity.avgSpeed > 0) {
    parts.push(`平均速度 ${formatSpeedByUnit(activity.avgSpeed, unit)}`)
  }
  if (parts.length === 0) {
    return undefined
  }
  return {
    key: 'overview',
    kind: 'info',
    title: '骑行概览',
    text: `${parts.join('，')}。`,
  }
}

/**
 * 逐点记录的最大累计距离（无距离数据时 undefined）。
 *
 * @param records 逐点记录
 * @returns 最大累计距离（米）
 */
function maxRecordDistance(records: readonly ActivityRecord[]): number | undefined {
  let maxDistance: number | undefined
  for (const record of records) {
    if (record.distance !== undefined) {
      maxDistance = maxDistance === undefined ? record.distance : Math.max(maxDistance, record.distance)
    }
  }
  return maxDistance
}

/**
 * 距离区间内某字段的均值（无有效数据返回 undefined）。
 *
 * @param records 逐点记录
 * @param field 指标字段
 * @param startMeters 区间起点（米）
 * @param endMeters 区间终点（米）
 * @returns 均值；无数据时 undefined
 */
function averageFieldInRange(
  records: readonly ActivityRecord[],
  field: 'speed' | 'power' | 'heartRate',
  startMeters: number,
  endMeters: number,
): number | undefined {
  let sum = 0
  let count = 0
  for (const record of records) {
    const value = record[field]
    if (record.distance === undefined || value === undefined) {
      continue
    }
    if (record.distance < startMeters || record.distance > endMeters) {
      continue
    }
    sum += value
    count += 1
  }
  return count > 0 ? sum / count : undefined
}

/**
 * 半程效率（平均功率 ÷ 平均心率）：有氧解耦口径的原料。
 *
 * @param records 逐点记录
 * @param startMeters 区间起点（米）
 * @param endMeters 区间终点（米）
 * @returns 功率/心率比值；数据不足时 undefined
 */
function halfEfficiency(
  records: readonly ActivityRecord[],
  startMeters: number,
  endMeters: number,
): number | undefined {
  const power = averageFieldInRange(records, 'power', startMeters, endMeters)
  const heartRate = averageFieldInRange(records, 'heartRate', startMeters, endMeters)
  if (power === undefined || heartRate === undefined || heartRate === 0) {
    return undefined
  }
  return power / heartRate
}

/**
 * 时长口语化文案：'2 小时 15 分' / '48 分钟' / '36 秒'。
 *
 * @param seconds 时长（秒）
 * @returns 文案
 */
function formatDurationText(seconds: number): string {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  }
  if (minutes > 0) {
    return `${minutes} 分钟`
  }
  return `${total} 秒`
}
