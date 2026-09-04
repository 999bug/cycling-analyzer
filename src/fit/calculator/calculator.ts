/**
 * 统计计算器：从标准化记录计算活动汇总指标。
 *
 * 数据一致性（规格 §45）：业务计算数据独立于 FIT 原始数据保存，
 * 算法升级时可重新计算 Activity Summary 而无需重新解析 FIT。
 *
 * 缺失字段一律返回 undefined（规格 §25：null ≠ 0）。
 */
import type { RawFitSession } from '@/fit/decoder/fitDecoder'
import type { ActivityRecord } from '@/types/activity'

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
  /** 累计爬升（米） */
  elevationGain: number
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
      elevationGain: 0,
    }
  }

  const duration = session?.totalTimerTime ?? recordsDuration(records)
  const elapsedTime = session?.totalElapsedTime ?? duration
  const distance = lastDistance(records) ?? estimateDistance(records)
  const avgSpeed = duration > 0 && distance > 0 ? distance / duration : undefined

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
    maxSpeed: maxOf(records.map((r) => r.speed)),
    avgHeartRate: averageOf(records.map((r) => r.heartRate)),
    maxHeartRate: maxOf(records.map((r) => r.heartRate)),
    // 行业口径（Strava）：avgCadence 排除滑行点（cadence=0），仅对踩踏中的
    // 点求平均，否则被零值拉低；maxCadence 仍取全部记录的最大值（含 0 异常点）
    avgCadence: averageExcludingZero(records.map((r) => r.cadence)),
    maxCadence: maxOf(records.map((r) => r.cadence)),
    avgPower: averageOf(records.map((r) => r.power)),
    maxPower: maxOf(records.map((r) => r.power)),
  }
}

/** 记录首末时间差（秒） */
function recordsDuration(records: ActivityRecord[]): number {
  const first = records[0].timestamp
  const last = records[records.length - 1].timestamp
  return Math.max(0, last - first)
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
 */
function calculateElevationGain(records: ActivityRecord[]): number {
  let gain = 0
  let prevAltitude: number | undefined = undefined
  for (const record of records) {
    if (record.altitude === undefined) {
      continue
    }
    if (prevAltitude !== undefined && record.altitude > prevAltitude) {
      gain += record.altitude - prevAltitude
    }
    prevAltitude = record.altitude
  }
  return gain
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

/** 非空数值的平均值 */
function averageOf(values: (number | undefined)[]): number | undefined {
  const valid = values.filter((v): v is number => v !== undefined)
  if (valid.length === 0) {
    return undefined
  }
  return valid.reduce((sum, v) => sum + v, 0) / valid.length
}

/**
 * 排除零值的非空数值平均值（行业口径 avgCadence 用：滑行点 cadence=0
 * 不计入分母，避免被拉低；全为 0/缺失时返回 undefined）。
 */
function averageExcludingZero(values: (number | undefined)[]): number | undefined {
  const valid = values.filter((v): v is number => v !== undefined && v > 0)
  if (valid.length === 0) {
    return undefined
  }
  return valid.reduce((sum, v) => sum + v, 0) / valid.length
}

/**
 * 非空数值的最大值。用 for 循环而非 `Math.max(...valid)` 展开——
 * 后者 V8/WebKit 实参上限约 65536，5Hz 记录骑行 5 小时（≈9 万点）即
 * `RangeError: Maximum call stack size exceeded`。
 */
function maxOf(values: (number | undefined)[]): number | undefined {
  let max: number | undefined
  for (const v of values) {
    if (v === undefined) {
      continue
    }
    if (max === undefined || v > max) {
      max = v
    }
  }
  return max
}
