/**
 * 爬坡分析（纯函数）。
 *
 * 从逐点记录识别爬坡段：连续爬升（相邻点海拔正增量）累计 ≥ 30m
 * 且平均坡度 ≥ 1.5% 记为一个爬坡；下降或海拔缺失断开当前段。
 */
import type { ActivityRecord } from '@/types/activity'

/** 爬坡判定阈值：累计爬升（米） */
const CLIMB_MIN_GAIN_METERS = 30

/** 爬坡判定阈值：平均坡度（%） */
const CLIMB_MIN_AVG_GRADE_PERCENT = 1.5

/** 坡度计算最小点对距离（米）：过近点对（停车/低速噪声）坡度不可靠，跳过 */
const MIN_GRADE_DIST_METERS = 2

/** 单点海拔最大跳变（米）：超过视为 GPS/气压计噪声（真实爬升由坡度上限把关，此值宽松） */
const MAX_ALT_JUMP_METERS = 80

/** 坡度物理上限（%）：超过视为噪声（真实骑行坡道一般 <25%） */
const MAX_GRADE_PERCENT = 30

/** 一个爬坡段 */
export interface ClimbSegment {
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

  /** 最大坡度（%，段内相邻点最大） */
  maxGradePercent: number
}

/**
 * 识别逐点记录中的爬坡段。
 *
 * @param records 逐点记录（含海拔/距离；缺失字段跳过）
 * @returns 爬坡段（按出现顺序）；无合格爬坡时为空数组
 */
export function buildClimbs(records: readonly ActivityRecord[]): ClimbSegment[] {
  const climbs: ClimbSegment[] = []

  // 当前段状态：起点距离、累计爬升、累计下降、最大坡度、上一有效点
  let startDistance: number | undefined
  let gain = 0
  let maxGrade = 0
  let prev: { altitude: number; distance: number } | undefined

  /**
   * 封段：判定是否合格爬坡并记录。
   */
  function closeSegment(endDistance: number | undefined) {
    if (startDistance === undefined || endDistance === undefined) {
      return
    }
    const distance = endDistance - startDistance
    const avgGrade = distance > 0 ? (gain / distance) * 100 : 0
    if (gain >= CLIMB_MIN_GAIN_METERS && avgGrade >= CLIMB_MIN_AVG_GRADE_PERCENT) {
      climbs.push({
        startDistanceMeters: startDistance,
        endDistanceMeters: endDistance,
        distanceMeters: distance,
        elevationGain: gain,
        avgGradePercent: avgGrade,
        maxGradePercent: maxGrade,
      })
    }
  }

  for (const record of records) {
    // 海拔或距离缺失：断开当前段（无法计算坡度）
    if (record.altitude === undefined || record.distance === undefined) {
      closeSegment(prev?.distance)
      startDistance = undefined
      prev = undefined
      continue
    }

    if (prev !== undefined) {
      const deltaAlt = record.altitude - prev.altitude
      const deltaDist = record.distance - prev.distance
      // 噪声过滤：距离过近、海拔突跳、坡度超物理上限的点对跳过（不参与爬升与坡度）
      const validPair =
        deltaDist >= MIN_GRADE_DIST_METERS &&
        Math.abs(deltaAlt) <= MAX_ALT_JUMP_METERS &&
        (deltaDist === 0 || Math.abs((deltaAlt / deltaDist) * 100) <= MAX_GRADE_PERCENT)
      if (validPair) {
        const grade = (deltaAlt / deltaDist) * 100
        if (grade > maxGrade) {
          maxGrade = grade
        }
        if (deltaAlt > 0) {
          // 爬升：加入当前段
          if (startDistance === undefined) {
            startDistance = prev.distance
          }
          gain += deltaAlt
        } else if (deltaAlt < 0) {
          // 下降：累计下降（暂不判定长度，任何下降都视为段间坡顶）
          closeSegment(prev.distance)
          startDistance = undefined
          gain = 0
          maxGrade = 0
        }
      }
    }
    prev = { altitude: record.altitude, distance: record.distance }
  }

  closeSegment(prev?.distance)
  return climbs
}

/** UCI 坡级（近似规则；4 → HC 递进） */
export type UciCategory = 'HC' | 1 | 2 | 3 | 4

/**
 * UCI 坡级近似分类（基于长度 + 平均坡度的简化规则）。
 *
 * - HC：≥10km 且 ≥8%，或 ≥15km 且 ≥6%
 * - 1 级：≥8km 且 ≥6%
 * - 2 级：≥5km 且 ≥5%
 * - 3 级：≥3km 且 ≥4%
 * - 4 级：≥1km 且 ≥3%
 * - 其余（距离或坡度不足）null（不分类）
 *
 * @param distanceMeters 坡段长度（米）
 * @param avgGradePercent 平均坡度（%）
 * @returns 坡级；不满足最低标准时 null
 */
export function uciCategory(
  distanceMeters: number,
  avgGradePercent: number,
): UciCategory | null {
  const distanceKm = distanceMeters / 1000
  if (distanceKm >= 10 && avgGradePercent >= 8) {
    return 'HC'
  }
  if (distanceKm >= 15 && avgGradePercent >= 6) {
    return 'HC'
  }
  if (distanceKm >= 8 && avgGradePercent >= 6) {
    return 1
  }
  if (distanceKm >= 5 && avgGradePercent >= 5) {
    return 2
  }
  if (distanceKm >= 3 && avgGradePercent >= 4) {
    return 3
  }
  if (distanceKm >= 1 && avgGradePercent >= 3) {
    return 4
  }
  return null
}
