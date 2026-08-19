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
      if (deltaDist > 0) {
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
