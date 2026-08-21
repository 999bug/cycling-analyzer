/**
 * 骑行质量评分（纯函数）。
 *
 * 综合评分 = 各分项得分的算术平均（有数据的分项），每项 0-100：
 * - 配速稳定性：速度变异系数（CV）越小越稳
 * - 心率控制：心率变异系数越小越平稳（无过大波动）
 * - 功率稳定性：功率变异系数越小越平稳（输出均匀）
 * - 爬坡表现：坡段平均功率 / 全程平均功率（爬坡时是否保持输出）
 * - 后程状态：后半程平均速度 / 前半程（是否掉速、体能有衰竭）
 *
 * 缺失字段按分项跳过（不伪造 0），全部缺失时综合评分 undefined。
 * 无数据的阈值不产生无依据的评分（规格 §26 同源原则）。
 */
import type { ActivityRecord } from '../../types/activity'
import { buildClimbs } from '../activity/climbs'
import { climbPeakDistance } from '../activity/segments'

/** 分项 key */
export type QualitySubScoreKey =
  | 'paceStability'
  | 'heartRateControl'
  | 'powerStability'
  | 'climbPerformance'
  | 'endurance'

/** 分项得分 */
export interface QualitySubScore {
  /** 分项 key */
  key: QualitySubScoreKey

  /** 分项展示名 */
  label: string

  /** 得分（0-100；数据缺失时 undefined） */
  score: number | undefined
}

/** 骑行质量评分结果 */
export interface QualityScore {
  /** 综合评分（0-100；无任何分项数据时 undefined） */
  overall: number | undefined

  /** 各分项得分（缺失数据的项 score 为 undefined） */
  subScores: QualitySubScore[]

  /** 总体评价文案（综合评分无数据时 undefined） */
  verdict: string | undefined
}

/** 变异系数满分阈值（CV ≤ 该值时得 100 分） */
const CV_FULL_SCORE = 0.08

/** 变异系数零分阈值（CV ≥ 该值时得 0 分） */
const CV_ZERO_SCORE = 0.35

/** 最小样本数（少于该样本数不计算变异系数类分项） */
const MIN_CV_SAMPLES = 10

/** 爬坡表现满分坡度功率比（坡段均功率 ≥ 全程均功率该倍数时 100 分） */
const CLIMB_FULL_RATIO = 1.05

/** 爬坡表现零分坡度功率比（坡段均功率 ≤ 全程均功率该倍数时 0 分） */
const CLIMB_ZERO_RATIO = 0.55

/** 后程状态满分前后速度比（后半程 ≥ 前半程该比例时 100 分） */
const ENDURANCE_FULL_RATIO = 0.9

/** 后程状态零分前后速度比（后半程 ≤ 前半程该比例时 0 分） */
const ENDURANCE_ZERO_RATIO = 0.4

/** 前后半程切分点（后半程起点比例） */
const ENDURANCE_SPLIT_RATIO = 0.5

/** 分项展示名 */
const SUB_SCORE_LABELS: Record<QualitySubScoreKey, string> = {
  paceStability: '配速稳定性',
  heartRateControl: '心率控制',
  powerStability: '功率稳定性',
  climbPerformance: '爬坡表现',
  endurance: '后程状态',
}

/** 综合评价档位（按综合分阈值从高到低） */
const VERDICT_TIERS: ReadonlyArray<{ min: number; text: string }> = [
  { min: 85, text: '状态出色：配速与输出均匀，体能保持良好' },
  { min: 70, text: '表现良好：整体稳定，部分指标可更均匀' },
  { min: 55, text: '表现一般：输出波动明显，建议调整节奏' },
  { min: 0, text: '状态欠佳：波动较大或后程掉速明显' },
]

/**
 * 计算骑行质量评分。
 *
 * @param records 逐点记录（含速度/功率/心率/距离）
 * @returns 综合评分 + 分项得分 + 总体评价
 */
export function computeQualityScore(records: readonly ActivityRecord[]): QualityScore {
  const subScores: QualitySubScore[] = [
    { key: 'paceStability', label: SUB_SCORE_LABELS.paceStability, score: scoreStability(records, 'speed') },
    { key: 'heartRateControl', label: SUB_SCORE_LABELS.heartRateControl, score: scoreStability(records, 'heartRate') },
    { key: 'powerStability', label: SUB_SCORE_LABELS.powerStability, score: scoreStability(records, 'power') },
    { key: 'climbPerformance', label: SUB_SCORE_LABELS.climbPerformance, score: scoreClimbPerformance(records) },
    { key: 'endurance', label: SUB_SCORE_LABELS.endurance, score: scoreEndurance(records) },
  ]

  const available = subScores.filter((item) => item.score !== undefined)
  const overall =
    available.length === 0
      ? undefined
      : Math.round(available.reduce((sum, item) => sum + (item.score as number), 0) / available.length)

  const verdict = overall === undefined ? undefined : verdictFor(overall)

  return { overall, subScores, verdict }
}

/**
 * 计算变异系数稳定性分项：CV 越小越稳定，线性映射到 [0, 100]。
 * 样本数不足或指标缺失时返回 undefined。
 *
 * @param records 逐点记录
 * @param field 指标字段
 * @returns 得分（0-100）；数据不足时 undefined
 */
function scoreStability(
  records: readonly ActivityRecord[],
  field: 'speed' | 'heartRate' | 'power',
): number | undefined {
  const values = records
    .map((record) => record[field])
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
  return mapScoreDescending(cv, CV_FULL_SCORE, CV_ZERO_SCORE)
}

/**
 * 计算爬坡表现分项：坡段平均功率 / 全程平均功率。
 * 爬坡时保持甚至提升输出得高分，掉功率得低分。
 * 无爬坡段或功率数据时返回 undefined。
 *
 * @param records 逐点记录
 * @returns 得分（0-100）；数据不足时 undefined
 */
function scoreClimbPerformance(records: readonly ActivityRecord[]): number | undefined {
  const climbs = buildClimbs(records)
  if (climbs.length === 0) {
    return undefined
  }

  // 全程平均功率
  const overall = averageField(records, 'power')
  if (overall === undefined || overall === 0) {
    return undefined
  }

  // 坡段平均功率：各坡段内按距离求均值，再按坡段等权平均
  let climbSum = 0
  let climbCount = 0
  for (const climb of climbs) {
    const peak = climbPeakDistance(records, climb)
    const avg = averageFieldInRange(records, 'power', climb.startDistanceMeters, peak)
    if (avg !== undefined) {
      climbSum += avg
      climbCount += 1
    }
  }
  if (climbCount === 0) {
    return undefined
  }
  const ratio = (climbSum / climbCount) / overall
  return mapScoreAscending(ratio, CLIMB_FULL_RATIO, CLIMB_ZERO_RATIO)
}

/**
 * 计算后程状态分项：后半程平均速度 / 前半程平均速度。
 * 后程不掉速（甚至负分段）得高分，掉速明显得低分。
 * 速度或距离数据不足时返回 undefined。
 *
 * @param records 逐点记录
 * @returns 得分（0-100）；数据不足时 undefined
 */
function scoreEndurance(records: readonly ActivityRecord[]): number | undefined {
  const split = midpointDistance(records)
  if (split === undefined) {
    return undefined
  }
  const firstHalf = averageFieldInRange(records, 'speed', 0, split)
  const secondHalf = averageFieldInRange(records, 'speed', split, Number.POSITIVE_INFINITY)
  if (firstHalf === undefined || secondHalf === undefined || firstHalf === 0) {
    return undefined
  }
  const ratio = secondHalf / firstHalf
  return mapScoreAscending(ratio, ENDURANCE_FULL_RATIO, ENDURANCE_ZERO_RATIO)
}

/**
 * 计算路线中点距离：取逐点距离最大值的一半；无距离数据返回 undefined。
 *
 * @param records 逐点记录
 * @returns 中点距离（米）
 */
function midpointDistance(records: readonly ActivityRecord[]): number | undefined {
  let maxDistance = 0
  let hasDistance = false
  for (const record of records) {
    if (record.distance !== undefined) {
      hasDistance = true
      maxDistance = Math.max(maxDistance, record.distance)
    }
  }
  if (!hasDistance || maxDistance === 0) {
    return undefined
  }
  return maxDistance * ENDURANCE_SPLIT_RATIO
}

/**
 * 全数据范围内某字段的均值（无有效数据返回 undefined）。
 *
 * @param records 逐点记录
 * @param field 指标字段
 * @returns 均值；无数据时 undefined
 */
function averageField(
  records: readonly ActivityRecord[],
  field: 'speed' | 'power',
): number | undefined {
  const values = records
    .map((record) => record[field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 0) {
    return undefined
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
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
  field: 'speed' | 'power',
  startMeters: number,
  endMeters: number,
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
 * 将数值按两个锚点线性映射到 [0, 100] 并裁剪（无魔法阈值，锚点为命名常量）。
 * 值越大分越高：fullValue 及以上得 100，zeroValue 及以下得 0。
 *
 * @param value 实际值
 * @param fullValue 满分锚点（值 ≥ 此阈值得 100）
 * @param zeroValue 零分锚点（值 ≤ 此阈值得 0）
 * @returns 得分（0-100）
 */
function mapScoreAscending(value: number, fullValue: number, zeroValue: number): number {
  if (value >= fullValue) {
    return 100
  }
  if (value <= zeroValue) {
    return 0
  }
  return Math.round(((value - zeroValue) / (fullValue - zeroValue)) * 100)
}

/**
 * 将数值按两个锚点线性映射到 [0, 100] 并裁剪（无魔法阈值，锚点为命名常量）。
 * 值越小分越高：fullValue 及以下得 100，zeroValue 及以上得 0。
 *
 * @param value 实际值
 * @param fullValue 满分锚点（值 ≤ 此阈值得 100）
 * @param zeroValue 零分锚点（值 ≥ 此阈值得 0）
 * @returns 得分（0-100）
 */
function mapScoreDescending(value: number, fullValue: number, zeroValue: number): number {
  if (value <= fullValue) {
    return 100
  }
  if (value >= zeroValue) {
    return 0
  }
  return Math.round(((zeroValue - value) / (zeroValue - fullValue)) * 100)
}

/**
 * 综合评分 → 总体评价文案。
 *
 * @param overall 综合评分（0-100）
 * @returns 评价文案
 */
function verdictFor(overall: number): string {
  const tier = VERDICT_TIERS.find((entry) => overall >= entry.min)
  return tier?.text ?? VERDICT_TIERS[VERDICT_TIERS.length - 1].text
}