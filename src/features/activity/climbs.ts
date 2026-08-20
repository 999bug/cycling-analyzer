/**
 * 爬坡分析（纯函数）。
 *
 * 从逐点记录识别爬坡段：连续爬升（相邻点海拔正增量累计）≥ 30m
 * 且平均坡度 ≥ 1.5% 记为一个爬坡；累计下降超过阈值或海拔缺失断开当前段。
 *
 * 噪声处理（2026-08-20 修复，针对真实设备数据漏检大坡）：
 * - 设备海拔为量化值（±1m），点距 3-5m 时单点对坡度天然超 30%，旧算法将其
 *   误判为噪声跳过，导致陡坡真实爬升被吞掉 90%、大坡漏检（真实 23km/942m
 *   的 HC 坡完全识别不出），且残余噪声点对让最大坡度虚高（真实 4% 的坡
 *   显示 29.8%）。
 * - 本实现不再按单点对坡度过滤，改用 80m 距离窗口平滑坡度（窗口内正增量
 *   累计 ÷ 窗口距离，抵消量化噪声；稀疏点距时退化为至少 5 点窗口）：
 *   maxGrade 取窗口平滑坡度最大值；gain 累计原始正增量（跳过海拔突跳尖刺）。
 * - 段内允许小幅下降（累计下降 ≤ 爬升 30% 且 10m 兜底），避免真实大坡被
 *   中间的小下坡拆碎；仅累计下降显著超过爬升时断开。
 */
import type { ActivityRecord } from '@/types/activity'

/** 爬坡判定阈值：累计爬升（米） */
const CLIMB_MIN_GAIN_METERS = 30

/** 爬坡判定阈值：平均坡度（%） */
const CLIMB_MIN_AVG_GRADE_PERCENT = 1.5

/** 平滑坡度窗口半径（米）：窗口内聚合抵消海拔量化噪声 */
const GRADE_WINDOW_METERS = 80

/** 窗口最少点数（前后各 2 点）：稀疏点距数据（测试/低采样设备）窗口退化为点数窗口 */
const WINDOW_MIN_POINTS = 2

/** 单点海拔最大跳变（米）：超过视为传感器尖刺（气压计重置/漂移），跳过不参与计算 */
const MAX_ALT_JUMP_METERS = 30

/** 断段比例：段内累计下降超过爬升的该比例时断开（允许段内小幅起伏） */
const LOSS_RATIO_TO_BREAK = 0.3

/** 断段兜底：累计下降超过该绝对米数才可能断开（防小爬升段被微降误拆） */
const LOSS_BREAK_FLOOR_METERS = 10

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

  /** 最大坡度（%，段内 80m 窗口平滑坡度的最大值） */
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

  // 当前段状态：起点距离、累计爬升、累计下降、最大平滑坡度、上一有效点
  let startDistance: number | undefined
  let gain = 0
  let loss = 0
  let maxGrade = 0
  let prev: { altitude: number; distance: number } | undefined

  /**
   * 当前点的平滑坡度（%）：以该点为中心 80m 窗口内正增量累计 ÷ 窗口首尾距离差。
   * 窗口不足点数时向前后各扩展至少 WINDOW_MIN_POINTS 个点（稀疏数据退化）。
   * 使用双指针：对每个点从左右扩展，累计窗口内的点对增量（跳过尖刺）。
   *
   * @param index 当前点在 records 中的下标
   * @returns 平滑坡度（%）
   */
  function windowGradeAt(index: number): number {
    let lo = index
    while (lo > 0 && (records[index].distance as number) - (records[lo - 1].distance as number) <= GRADE_WINDOW_METERS) {
      lo--
    }
    if (index - lo < WINDOW_MIN_POINTS) {
      lo = Math.max(0, index - WINDOW_MIN_POINTS)
    }
    let hi = index
    while (
      hi < records.length - 1 &&
      (records[hi + 1].distance as number) - (records[index].distance as number) <= GRADE_WINDOW_METERS
    ) {
      hi++
    }
    if (hi - index < WINDOW_MIN_POINTS) {
      hi = Math.min(records.length - 1, index + WINDOW_MIN_POINTS)
    }
    let wGain = 0
    for (let k = lo + 1; k <= hi; k++) {
      const dAlt = (records[k].altitude as number) - (records[k - 1].altitude as number)
      if (Math.abs(dAlt) <= MAX_ALT_JUMP_METERS && dAlt > 0) {
        wGain += dAlt
      }
    }
    const wDist = (records[hi].distance as number) - (records[lo].distance as number)
    return wDist > 0 ? (wGain / wDist) * 100 : 0
  }

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

  /**
   * 重置当前段状态（段断开或海拔缺失时）。
   */
  function resetSegment() {
    startDistance = undefined
    gain = 0
    loss = 0
    maxGrade = 0
  }

  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    // 海拔或距离缺失：断开当前段（无法计算坡度）
    if (record.altitude === undefined || record.distance === undefined) {
      closeSegment(prev?.distance)
      resetSegment()
      prev = undefined
      continue
    }

    if (prev !== undefined) {
      const deltaAlt = record.altitude - prev.altitude
      // 传感器尖刺（单点海拔突跳）：跳过该点对，不参与爬升/坡度
      const isSpike = Math.abs(deltaAlt) > MAX_ALT_JUMP_METERS
      if (!isSpike) {
        if (deltaAlt > 0) {
          if (startDistance === undefined) {
            startDistance = prev.distance
          }
          gain += deltaAlt
        } else if (deltaAlt < 0 && startDistance !== undefined) {
          // 下降：累计段内下降；超过断段阈值时断开（允许小幅起伏）
          const projectedLoss = loss + -deltaAlt
          const breakThreshold = Math.max(gain * LOSS_RATIO_TO_BREAK, LOSS_BREAK_FLOOR_METERS)
          if (projectedLoss > breakThreshold) {
            closeSegment(prev.distance)
            resetSegment()
          } else {
            loss = projectedLoss
          }
        }
      }
    }

    if (startDistance !== undefined) {
      const grade = windowGradeAt(index)
      if (grade > maxGrade) {
        maxGrade = grade
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
 * UCI 坡级分类（Strava 官方口径：长度 × 平均坡度 > 阈值）。
 *
 * Strava 公开公式（support.strava.com「Climb Categorization」）：
 * score = 长度（米）× 平均坡度（%）
 * - HC：score > 80000（如 23.6km × 4% = 94,200）
 * - 1 级：score > 64000
 * - 2 级：score > 32000
 * - 3 级：score > 16000
 * - 4 级：score > 8000
 * - 其余（不足 4 级）null（不分类）
 *
 * @param distanceMeters 坡段长度（米）
 * @param avgGradePercent 平均坡度（%）
 * @returns 坡级；不满足最低标准时 null
 */
export function uciCategory(
  distanceMeters: number,
  avgGradePercent: number,
): UciCategory | null {
  const score = distanceMeters * avgGradePercent
  if (score > 80000) {
    return 'HC'
  }
  if (score > 64000) {
    return 1
  }
  if (score > 32000) {
    return 2
  }
  if (score > 16000) {
    return 3
  }
  if (score > 8000) {
    return 4
  }
  return null
}