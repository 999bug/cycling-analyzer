/**
 * 统计计算器：从标准化记录计算活动汇总指标。
 *
 * 数据一致性（规格 §45）：业务计算数据独立于 FIT 原始数据保存，
 * 算法升级时可重新计算 Activity Summary 而无需重新解析 FIT。
 *
 * 设备值优先口径（速度/距离准确性修复）：session 提供的 totalDistance /
 * avgSpeed / maxSpeed 是设备在活动结束时写入的最终值（佳明 App 显示同源），
 * 比记录点回推更可靠——记录点可能在 session 结束前停止写入、GPS 漂移修正
 * 也不会回写记录点；缺失时才回退到记录计算。GPX 无 session，时长按
 * 「移动时间」估算（剔除静止段），否则红灯暂停会拉低均速（Strava 同口径）。
 *
 * 缺失字段一律返回 undefined（规格 §25：null ≠ 0）。
 */
import type { RawFitSession } from '@/fit/decoder/fitDecoder'
import type { ActivityRecord } from '@/types/activity'

/**
 * 移动判定速度阈值（m/s，≈1.8km/h，Strava 同级）：
 * 相邻点位移速度高于该值的时间段计入移动时间，低于视为静止（GPS 抖动单点
 * 位移通常 < 0.5m/s，不会累积进移动时间）。
 */
const MOVING_SPEED_THRESHOLD_MPS = 0.5

/**
 * 参与移动时间估算的最大采样间隔（秒）：超过视为记录缺失/长时间暂停，
 * 不计入移动时间（防止个别丢点把整段静止时间算进去）。
 */
const MOVING_GAP_LIMIT_SEC = 30

/**
 * 统计汇总结果（Activity 的部分字段）。
 */
export interface ActivitySummary {
  /** 计时时长（秒），优先会话 totalTimerTime */
  duration: number
  /** 总耗时（秒，含暂停），优先会话 totalElapsedTime */
  elapsedTime: number
  /** 总距离（米） */
  distance: number
  /** 累计爬升（米）；数据源无任何海拔字段时为 undefined（规格 §25 缺失≠0） */
  elevationGain?: number
  /** 累计下降（米） */
  elevationLoss?: number
  /** 卡路里（千卡，仅会话提供时存在） */
  calories?: number
  /** 平均速度（m/s） */
  avgSpeed?: number
  /** 最高速度（m/s） */
  maxSpeed?: number
  /** 平均心率（bpm） */
  avgHeartRate?: number
  /** 最高心率（bpm） */
  maxHeartRate?: number
  /** 平均踏频（rpm） */
  avgCadence?: number
  /** 最高踏频（rpm） */
  maxCadence?: number
  /** 平均功率（W） */
  avgPower?: number
  /** 最高功率（W） */
  maxPower?: number
}

/**
 * 计算活动统计汇总。
 *
 * @param records 标准化逐点记录
 * @param session 解码的会话原始数据（可选，提供计时与卡路里等设备汇总）
 */
export function calculateSummary(
  records: ActivityRecord[],
  session?: Partial<RawFitSession>,
): ActivitySummary {
  if (records.length === 0) {
    return {
      duration: 0,
      elapsedTime: 0,
      distance: 0,
      elevationGain: undefined,
    }
  }

  // 距离：设备最终值优先（佳明 App 显示同源），记录点可能提前停写或受漂移修正影响
  const distance = session?.totalDistance ?? lastDistance(records) ?? estimateDistance(records)
  // 时长：FIT 用设备计时（移动口径）；GPX 无 session，按移动时间估算剔除静止段；
  // 估算为 0（极稀疏轨迹/无距离数据无法判定移动）时回退首末时间差保底
  const duration = session?.totalTimerTime ?? (estimateMovingDuration(records) || recordsDuration(records))
  // 总耗时：含暂停，无会话时为记录首末时间差
  const elapsedTime = session?.totalElapsedTime ?? recordsDuration(records)
  // 平均速度：设备值与佳明 App 显示同源；缺失时距离/移动时长（同为移动口径）
  const avgSpeed =
    session?.avgSpeed !== undefined && session.avgSpeed > 0
      ? session.avgSpeed
      : duration > 0 && distance > 0
        ? distance / duration
        : undefined

  // 单次遍历聚合 max/avg：此前 7 个 maxOf/averageOf 各自 map 建 n 长中间数组，
  // 3 万点活动一次摘要计算分配 ~200 万个中间元素（GC 压力）；语义与逐字段
  // map+filter 完全一致（cadence 见下方行业口径注释）
  let maxSpeed: number | undefined
  let heartRateSum = 0
  let heartRateCount = 0
  let maxHeartRate: number | undefined
  let cadenceSum = 0
  let cadenceCount = 0
  let maxCadence: number | undefined
  let powerSum = 0
  let powerCount = 0
  let maxPower: number | undefined
  for (const record of records) {
    const { speed, heartRate, cadence, power } = record
    if (speed !== undefined && (maxSpeed === undefined || speed > maxSpeed)) {
      maxSpeed = speed
    }
    if (heartRate !== undefined) {
      heartRateSum += heartRate
      heartRateCount++
      if (maxHeartRate === undefined || heartRate > maxHeartRate) {
        maxHeartRate = heartRate
      }
    }
    if (cadence !== undefined) {
      if (maxCadence === undefined || cadence > maxCadence) {
        maxCadence = cadence
      }
      if (cadence > 0) {
        cadenceSum += cadence
        cadenceCount++
      }
    }
    if (power !== undefined) {
      powerSum += power
      powerCount++
      if (maxPower === undefined || power > maxPower) {
        maxPower = power
      }
    }
  }

  return {
    duration,
    elapsedTime,
    distance,
    // 爬升/下降优先采用设备预计算（session.totalAscent/totalDescent）——
    // 设备对原始气压高度已做平滑与尖刺过滤，避免我们按相邻正增量裸累加时
    // 受到高度量化噪声（±0.5~1m@1Hz）的虚增影响；缺失时回退到记录累加
    elevationGain: session?.totalAscent ?? calculateElevationGain(records),
    elevationLoss: session?.totalDescent ?? calculateElevationLoss(records),
    calories: session?.totalCalories,
    avgSpeed,
    // 最高速度同样优先设备最终值（高频采样峰值，记录点可能漏采瞬时峰）
    maxSpeed: session?.maxSpeed ?? maxSpeed,
    // 心率/功率优先设备值：暂停期间（红绿灯）records 平均会混入静息心率拉低
    // 均值，设备值与佳明 App 显示同源；设备写 0 表示无效，视为缺失回退
    avgHeartRate: pickPositive(session?.avgHeartRate) ?? (heartRateCount > 0 ? heartRateSum / heartRateCount : undefined),
    maxHeartRate: pickPositive(session?.maxHeartRate) ?? maxHeartRate,
    // 行业口径（Strava）：avgCadence 排除滑行点（cadence=0），仅对踩踏中的
    // 点求平均，否则被零值拉低；maxCadence 仍取全部记录的最大值（含 0 异常点）
    avgCadence: cadenceCount > 0 ? cadenceSum / cadenceCount : undefined,
    maxCadence,
    avgPower: pickPositive(session?.avgPower) ?? (powerCount > 0 ? powerSum / powerCount : undefined),
    maxPower: pickPositive(session?.maxPower) ?? maxPower,
  }
}

/** 取正值（设备写 0 表示无效字段，视为缺失） */
function pickPositive(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined
}

/** 记录首末时间差（秒） */
function recordsDuration(records: ActivityRecord[]): number {
  const first = records[0].timestamp
  const last = records[records.length - 1].timestamp
  return Math.max(0, last - first)
}

/**
 * 估算移动时长（秒）：累计相邻点间「有位移」的时间段。
 *
 * 用于无 session 的数据源（GPX）：GPX 没有设备计时/暂停信息，若直接用
 * 首末时间差，红绿灯与休息的静止时间会拉低均速（Strava/佳明 App 均按
 * 移动时间显示均速）。判定：相邻点位移速度高于 MOVING_SPEED_THRESHOLD_MPS
 * 才计入；超过 MOVING_GAP_LIMIT_SEC 的间隔视为记录缺失不参与。
 *
 * @param records 标准化逐点记录（依赖累计距离字段）
 */
function estimateMovingDuration(records: ActivityRecord[]): number {
  let moving = 0
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]
    const curr = records[i]
    const dt = curr.timestamp - prev.timestamp
    if (dt <= 0 || dt > MOVING_GAP_LIMIT_SEC) {
      continue
    }
    const dd = (curr.distance ?? 0) - (prev.distance ?? 0)
    if (dd <= 0) {
      continue
    }
    if (dd / dt > MOVING_SPEED_THRESHOLD_MPS) {
      moving += dt
    }
  }
  return moving
}

/** 末点累计距离（米），无 distance 字段时为 undefined */
function lastDistance(records: ActivityRecord[]): number | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].distance !== undefined) {
      return records[i].distance
    }
  }
  return undefined
}

/**
 * 无距离字段时按前点速度 × 时间间隔累加估算。
 */
function estimateDistance(records: ActivityRecord[]): number {
  let distance = 0
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]
    const speed = prev.speed ?? 0
    const delta = records[i].timestamp - prev.timestamp
    if (delta > 0) {
      distance += speed * delta
    }
  }
  return distance
}

/**
 * 累计爬升：相邻有效海拔正增量之和。
 * 海拔缺失的点跳过，与下一个有效点比较。
 *
 * 全部记录均无海拔时返回 undefined（规格 §25 缺失≠0）：行者等 App 导出的
 * GPX 不含 <ele>，爬升无从计算，UI 应显示「—」而非伪造的 +0 m；
 * 有海拔但全程无正增量的平路活动仍返回 0（真实测量值）。
 */
function calculateElevationGain(records: ActivityRecord[]): number | undefined {
  let gain = 0
  let seenAltitude = false
  let prevAltitude: number | undefined = undefined
  for (const record of records) {
    if (record.altitude === undefined) {
      continue
    }
    seenAltitude = true
    if (prevAltitude !== undefined && record.altitude > prevAltitude) {
      gain += record.altitude - prevAltitude
    }
    prevAltitude = record.altitude
  }
  return seenAltitude ? gain : undefined
}

/**
 * 累计下降：相邻有效海拔负增量绝对值之和。
 * 无下降时返回 undefined（区别于 0）。
 */
function calculateElevationLoss(records: ActivityRecord[]): number | undefined {
  let loss = 0
  let prevAltitude: number | undefined = undefined
  for (const record of records) {
    if (record.altitude === undefined) {
      continue
    }
    if (prevAltitude !== undefined && record.altitude < prevAltitude) {
      loss += prevAltitude - record.altitude
    }
    prevAltitude = record.altitude
  }
  return loss > 0 ? loss : undefined
}
