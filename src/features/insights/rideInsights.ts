/**
 * 动态骑行洞察（纯函数，UI-1 / 评审 P0-02）。
 *
 * 把一次骑行的真实数据转译为自然语言洞察：
 * - 强度档位（IF 或心率占比，恢复/耐力/节奏/阈值以上）
 * - 后程衰减（前 30% vs 后 30% 距离段平均速度）
 * - 心率漂移（前后半程功率/心率比下降 = 有氧解耦）
 * - 爬坡负荷（每公里爬升）与主要爬坡（UCI 分级）
 * - 长距离、配速稳定性、极速、GPS 漂移
 * - 踏频（偏低/稳定）、变动指数 VI（输出平顺/波动）、峰值功率（vs FTP）、
 *   阈值以上输出时间、停走比例、地形构成（爬/平/下坡时间占比）、近期对比
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
import { formatDurationText } from '@/utils/format'
import { RECENT_BASELINE_MIN_SAMPLES, type RecentBaseline } from '@/features/insights/recentBaseline'

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

  /**
   * 历史对比基线（近期骑行均值，调用方经 buildRecentBaseline 聚合后传入）。
   * 缺省或样本不足时不生成近期对比洞察。
   */
  recentBaseline?: RecentBaseline
}

/** 输出洞察条数上限（评审 P0-02 为 3~5 条，扩充生成器后放宽至 6 条） */
const MAX_INSIGHTS = 6

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

/** 踏频有效下限（rpm）：低于该值视为滑行/artifact，不参与踏频统计 */
const CADENCE_MIN_RPM = 30

/** 踏频偏低判定（rpm）：有效踏频均值低于该值为低踏频（大齿比磨踩） */
const CADENCE_LOW_RPM = 65

/** 踏频稳定判定：有效踏频变异系数 ≤ 该值且均值不低于 80 */
const CADENCE_STEADY_CV = 0.15

/** 踏频稳定判定的均值下限（rpm） */
const CADENCE_STEADY_MIN_RPM = 80

/** 输出平顺判定：变动指数 VI（NP ÷ 平均功率）≤ 该值 */
const VI_SMOOTH_MAX = 1.05

/** 输出波动判定：变动指数 VI ≥ 该值 */
const VI_SURGE_MIN = 1.15

/** 峰值功率滚动窗口（秒）：1 分钟 / 5 分钟 / 20 分钟 */
const PEAK_POWER_WINDOW_SECONDS = [60, 300, 1200] as const

/** 20 分钟峰值功率接近 FTP 判定：≥ FTP × 该值 */
const PEAK_20MIN_FTP_RATIO = 0.95

/** 5 分钟峰值功率亮眼判定：≥ FTP × 该值 */
const PEAK_5MIN_FTP_RATIO = 1.1

/** 1 分钟峰值功率亮眼判定：≥ FTP × 该值（无氧爆发） */
const PEAK_1MIN_FTP_RATIO = 1.5

/** 阈值以上输出时间占比判定：功率 ≥ FTP 的样本占比 ≥ 该值 */
const THRESHOLD_TIME_SHARE = 0.1

/** 停走判定速度（m/s）：低于该值视为停歇或蠕行 */
const STOP_SPEED_MPS = 0.5

/** 频繁停走判定：停歇样本占比 ≥ 该值 */
const STOPGO_HIGH_SHARE = 0.2

/** 几乎不停判定：停歇样本占比 ≤ 该值 */
const STOPGO_FEW_SHARE = 0.02

/** 停走统计最少速度样本数（约 1 分钟 @1Hz） */
const STOPGO_MIN_SAMPLES = 60

/** 地形切分：坡度 ≥ 该值（%）计为爬坡 */
const TERRAIN_CLIMB_GRADE = 2

/** 地形切分：坡度 ≤ 该值（%）计为下坡 */
const TERRAIN_DESCENT_GRADE = -2

/** 地形切分：相邻点距离增量小于该值（米）时坡度噪声过大，跳过 */
const TERRAIN_MIN_DIST_DELTA = 3

/** 地形切分最少有效段数（海拔数据覆盖率不足时不生成） */
const TERRAIN_MIN_SEGMENTS = 50

/** 爬坡占比洞察判定：爬坡时间占比 ≥ 该值 */
const TERRAIN_CLIMB_SHARE = 0.2

/** 下坡占比洞察判定：下坡时间占比 ≥ 该值 */
const TERRAIN_DESCENT_SHARE = 0.35

/** 近期对比：本次均速快于近期均值超过该值（%）时生成正面洞察 */
const HISTORY_FASTER_PERCENT = 5

/** 近期对比：本次均速慢于近期均值超过该值（%）时生成中性洞察 */
const HISTORY_SLOWER_PERCENT = 8

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
    cadenceInsight(records),
    variabilityIndexInsight(activity),
    peakPowerInsight(records, options),
    thresholdTimeInsight(records, options),
    stopGoInsight(records),
    terrainTimeInsight(records),
    historyComparisonInsight(activity, options),
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

/** 功率强度档位（按占 FTP 比例；导出供骑行总结复用） */
export function intensityTierByPower(ratio: number): { label: string; note: string } {
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

/** 心率强度档位（按占最大心率比例；导出供骑行总结复用） */
export function intensityTierByHeartRate(ratio: number): { label: string; note: string } {
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
 * 踏频洞察：有效踏频（≥ CADENCE_MIN_RPM，过滤滑行 0 值）的均值与变异系数。
 *
 * @param records 逐点记录
 * @returns 洞察；踏频样本不足时 undefined
 */
function cadenceInsight(records: readonly ActivityRecord[]): RideInsight | undefined {
  const values = records
    .map((record) => record.cadence)
    .filter((value): value is number => typeof value === 'number' && value >= CADENCE_MIN_RPM)
  if (values.length < MIN_CV_SAMPLES) {
    return undefined
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const cv = Math.sqrt(variance) / mean

  if (mean < CADENCE_LOW_RPM) {
    return {
      key: 'cadence',
      kind: 'info',
      title: '踏频偏低',
      text: `平均踏频 ${Math.round(mean)} rpm，偏低——试试高踏频轻齿比，减轻膝盖与肌肉负担`,
    }
  }
  if (mean >= CADENCE_STEADY_MIN_RPM && cv <= CADENCE_STEADY_CV) {
    return {
      key: 'cadence',
      kind: 'positive',
      title: '踏频稳定',
      text: `平均踏频 ${Math.round(mean)} rpm 且波动小（CV ${(cv * 100).toFixed(CV_PERCENT_PRECISION)}%），蹬踏节奏稳定`,
    }
  }
  return undefined
}

/**
 * 变动指数洞察：VI = NP ÷ 平均功率，衡量输出平稳度。
 *
 * @param activity 活动摘要（需同时有 NP 与平均功率）
 * @returns 洞察；数据不足或处于中间区间时 undefined
 */
function variabilityIndexInsight(activity: Activity): RideInsight | undefined {
  const np = activity.normalizedPower
  const ap = activity.avgPower
  if (np === undefined || ap === undefined || ap <= 0) {
    return undefined
  }
  const vi = np / ap
  if (vi >= VI_SURGE_MIN) {
    return {
      key: 'variabilityIndex',
      kind: 'info',
      title: '输出波动',
      text: `变动指数 VI ${vi.toFixed(2)}，NP 明显高于均功率，含较多冲刺或间歇输出`,
    }
  }
  if (vi <= VI_SMOOTH_MAX) {
    return {
      key: 'variabilityIndex',
      kind: 'positive',
      title: '输出平顺',
      text: `变动指数 VI 仅 ${vi.toFixed(2)}，输出平顺，接近匀功率骑行`,
    }
  }
  return undefined
}

/**
 * 峰值功率洞察：1/5/20 分钟滚动窗口峰值 vs FTP（需 FTP 才有对比锚点）。
 *
 * @param records 逐点记录
 * @param options 含 FTP
 * @returns 洞察；无 FTP / 无功率 / 峰值不亮眼时 undefined
 */
function peakPowerInsight(
  records: readonly ActivityRecord[],
  options: RideInsightsOptions,
): RideInsight | undefined {
  const ftp = options.ftp
  if (ftp === undefined || ftp <= 0) {
    return undefined
  }

  const powered = records.filter(
    (record) => typeof record.power === 'number' && record.power > 0,
  )
  if (powered.length < MIN_CV_SAMPLES) {
    return undefined
  }
  const interval = medianIntervalSeconds(powered)

  // 20 分钟 → 5 分钟 → 1 分钟逐级放宽，报告最亮眼的一档
  const peaks = PEAK_POWER_WINDOW_SECONDS.map((seconds) => ({
    seconds,
    best: bestRollingAvgPower(powered, Math.max(1, Math.round(seconds / interval))),
  }))

  const peak20 = peaks.find((peak) => peak.seconds === 1200)?.best
  if (peak20 !== undefined && peak20 >= ftp * PEAK_20MIN_FTP_RATIO) {
    return {
      key: 'peakPower',
      kind: 'positive',
      title: '峰值功率',
      text: `20 分钟峰值功率 ${Math.round(peak20)} W，达 FTP 的 ${Math.round((peak20 / ftp) * 100)}%，接近 FTP 测试水平`,
    }
  }
  const peak5 = peaks.find((peak) => peak.seconds === 300)?.best
  if (peak5 !== undefined && peak5 >= ftp * PEAK_5MIN_FTP_RATIO) {
    return {
      key: 'peakPower',
      kind: 'info',
      title: '峰值功率',
      text: `5 分钟峰值功率 ${Math.round(peak5)} W，达 FTP 的 ${Math.round((peak5 / ftp) * 100)}%，有氧能力亮眼`,
    }
  }
  const peak1 = peaks.find((peak) => peak.seconds === 60)?.best
  if (peak1 !== undefined && peak1 >= ftp * PEAK_1MIN_FTP_RATIO) {
    return {
      key: 'peakPower',
      kind: 'info',
      title: '峰值功率',
      text: `1 分钟峰值功率 ${Math.round(peak1)} W，达 FTP 的 ${Math.round((peak1 / ftp) * 100)}%，无氧爆发不错`,
    }
  }
  return undefined
}

/**
 * 阈值以上输出时间洞察：功率 ≥ FTP 的样本占比（需 FTP）。
 *
 * @param records 逐点记录
 * @param options 含 FTP
 * @returns 洞察；无 FTP / 无功率 / 占比不足时 undefined
 */
function thresholdTimeInsight(
  records: readonly ActivityRecord[],
  options: RideInsightsOptions,
): RideInsight | undefined {
  const ftp = options.ftp
  if (ftp === undefined || ftp <= 0) {
    return undefined
  }
  const powers = records
    .map((record) => record.power)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  if (powers.length < MIN_CV_SAMPLES) {
    return undefined
  }
  const aboveShare = powers.filter((power) => power >= ftp).length / powers.length
  if (aboveShare >= THRESHOLD_TIME_SHARE) {
    return {
      key: 'thresholdTime',
      kind: 'info',
      title: '阈值输出',
      text: `功率达 FTP 以上的输出时间占 ${Math.round(aboveShare * 100)}%，含较扎实的高强度段落`,
    }
  }
  return undefined
}

/**
 * 停走分析洞察：零速/蠕行样本占比。
 *
 * @param records 逐点记录
 * @returns 洞察；速度样本不足时 undefined
 */
function stopGoInsight(records: readonly ActivityRecord[]): RideInsight | undefined {
  const speeds = records
    .map((record) => record.speed)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (speeds.length < STOPGO_MIN_SAMPLES) {
    return undefined
  }
  const stopShare = speeds.filter((speed) => speed < STOP_SPEED_MPS).length / speeds.length
  const stopPercent = Math.round(stopShare * 100)
  if (stopShare >= STOPGO_HIGH_SHARE) {
    return {
      key: 'stopGo',
      kind: 'info',
      title: '频繁停走',
      text: `约 ${stopPercent}% 时间处于停歇或蠕行，可能是市区红绿灯多或结伴骑行`,
    }
  }
  if (stopShare <= STOPGO_FEW_SHARE) {
    return {
      key: 'stopGo',
      kind: 'positive',
      title: '节奏连贯',
      text: `全程几乎未停歇（停走时间仅 ${stopPercent}%），节奏保持得很好`,
    }
  }
  return undefined
}

/**
 * 地形构成洞察：按坡度把骑行时间切成爬坡/平路/下坡三段占比。
 *
 * 坡度来源：优先记录自带的 grade，缺失时由相邻点海拔与距离增量推算
 * （距离增量过小时坡度噪声大，跳过不计）。
 *
 * @param records 逐点记录（需含海拔）
 * @returns 洞察；海拔覆盖不足或地形特征不明显时 undefined
 */
function terrainTimeInsight(records: readonly ActivityRecord[]): RideInsight | undefined {
  let climb = 0
  let descent = 0
  let classified = 0
  for (let index = 1; index < records.length; index += 1) {
    const prev = records[index - 1]
    const current = records[index]
    if (
      prev.altitude === undefined ||
      current.altitude === undefined ||
      prev.distance === undefined ||
      current.distance === undefined
    ) {
      continue
    }
    const distDelta = current.distance - prev.distance
    if (distDelta < TERRAIN_MIN_DIST_DELTA) {
      continue
    }
    const slope = ((current.altitude - prev.altitude) / distDelta) * 100
    classified += 1
    if (slope >= TERRAIN_CLIMB_GRADE) {
      climb += 1
    } else if (slope <= TERRAIN_DESCENT_GRADE) {
      descent += 1
    }
  }
  if (classified < TERRAIN_MIN_SEGMENTS) {
    return undefined
  }

  const flat = classified - climb - descent
  const climbShare = climb / classified
  const descentShare = descent / classified
  const shares = `约 ${Math.round(climbShare * 100)}% 时间在爬坡、${Math.round((flat / classified) * 100)}% 平路、${Math.round(descentShare * 100)}% 下坡`

  if (climbShare >= TERRAIN_CLIMB_SHARE) {
    return {
      key: 'terrain',
      kind: 'info',
      title: '地形构成',
      text: `${shares}（按海拔切分），爬坡占比较高`,
    }
  }
  if (descentShare >= TERRAIN_DESCENT_SHARE) {
    return {
      key: 'terrain',
      kind: 'info',
      title: '地形构成',
      text: `${shares}（按海拔切分），下坡为主，注意控车安全`,
    }
  }
  return undefined
}

/**
 * 近期对比洞察：本次均速 vs 近期骑行均值（基线由调用方聚合传入）。
 *
 * @param activity 活动摘要
 * @param options 含 recentBaseline
 * @returns 洞察；基线缺失 / 样本不足 / 差异不显著时 undefined
 */
function historyComparisonInsight(
  activity: Activity,
  options: RideInsightsOptions,
): RideInsight | undefined {
  const baseline = options.recentBaseline
  if (
    baseline === undefined ||
    baseline.sampleCount < RECENT_BASELINE_MIN_SAMPLES ||
    baseline.avgSpeed === undefined ||
    baseline.avgSpeed <= 0 ||
    activity.avgSpeed === undefined
  ) {
    return undefined
  }

  const diffPercent = ((activity.avgSpeed - baseline.avgSpeed) / baseline.avgSpeed) * 100
  if (diffPercent >= HISTORY_FASTER_PERCENT) {
    return {
      key: 'recentCompare',
      kind: 'positive',
      title: '近期对比',
      text: `均速较最近 ${baseline.sampleCount} 次骑行平均快 ${diffPercent.toFixed(1)}%，状态在线`,
    }
  }
  if (diffPercent <= -HISTORY_SLOWER_PERCENT) {
    return {
      key: 'recentCompare',
      kind: 'info',
      title: '近期对比',
      text: `均速较最近 ${baseline.sampleCount} 次骑行平均慢 ${Math.abs(diffPercent).toFixed(1)}%，或与路况/休整有关，单次波动不必在意`,
    }
  }
  return undefined
}

/**
 * 带功率记录的时间戳中位间隔（秒）：滚动窗口换算样本数的依据。
 *
 * @param powered 带功率的逐点记录（非空）
 * @returns 中位间隔（秒）；无法计算时退化为 1
 */
function medianIntervalSeconds(powered: readonly ActivityRecord[]): number {
  const gaps: number[] = []
  for (let index = 1; index < powered.length; index += 1) {
    const gap = powered[index].timestamp - powered[index - 1].timestamp
    if (gap > 0) {
      gaps.push(gap)
    }
  }
  if (gaps.length === 0) {
    return 1
  }
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/**
 * 滚动窗口最大功率均值（前缀和实现，O(n)）。
 *
 * 注意：样本间间隔近似按中位间隔处理（1s/多秒记录均可用，为工程近似）。
 *
 * @param powers 带功率记录序列（按时间序）
 * @param windowCount 窗口样本数（≥1）
 * @returns 窗口内最大平均功率（W）；样本不足窗口大小时 undefined
 */
function bestRollingAvgPower(
  powered: readonly ActivityRecord[],
  windowCount: number,
): number | undefined {
  if (windowCount < 1 || powered.length < windowCount) {
    return undefined
  }
  const values = powered.map((record) => record.power as number)
  const prefix: number[] = [0]
  for (const value of values) {
    prefix.push(prefix[prefix.length - 1] + value)
  }
  let best = Number.NEGATIVE_INFINITY
  for (let end = windowCount; end <= values.length; end += 1) {
    const avg = (prefix[end] - prefix[end - windowCount]) / windowCount
    if (avg > best) {
      best = avg
    }
  }
  return best
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
// formatDurationText 抽到 @/utils/format 共享，避免两处重复实现

