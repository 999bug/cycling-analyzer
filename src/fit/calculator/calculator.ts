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
 * 「移动时间」估算（剔除长暂停与完全静止段，有挪动的短停计时不停），
 * 否则红灯暂停会拉低均速（行者/Strava 同口径）。
 *
 * 缺失字段一律返回 undefined（规格 §25：null ≠ 0）。
 */
import type { RawFitSession } from '@/fit/decoder/fitDecoder'
import { movingDurationOf } from '@/features/activity/movingTime'
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
  // 时长：FIT 用设备计时（移动口径）；GPX 无 session，按移动时间估算
  // （剔除长暂停与完全静止段，有挪动的短停计时不停）；估算为 0（极稀疏
  // 轨迹/无距离数据无法判定移动）时回退首末时间差保底
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
    // 设备对原始气压高度已做平滑与尖刺过滤；缺失（GPX 等无会话数据源）时
    // 用记录海拔做「平滑 + 滞回 + 坡度门限」估算，避免相邻正增量裸累加时
    // 被高度量化噪声（±0.5~1m@1Hz）虚增（实测可虚高 50%+）
    ...calculateElevation(session, records),
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
 * 估算移动时长（秒）：按相邻点间隔分档累计「有位移/未暂停」的时间段。
 *
 * 用于无 session 的数据源（GPX）：GPX 没有设备计时/暂停信息，若直接用
 * 首末时间差，红绿灯与休息的静止时间会拉低均速（行者/Strava/佳明 App 均
 * 按移动时间显示均速）。判定规则见 `@/features/activity/movingTime`
 * （与在线回放的时间轴压缩同源，保证均速分母与回放时长口径一致）。
 *
 * @param records 标准化逐点记录（依赖累计距离字段）
 */
function estimateMovingDuration(records: ActivityRecord[]): number {
  return movingDurationOf(records)
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
 * 海拔平滑目标时间窗（秒）：滑动平均覆盖约 30s 轨迹，滤掉气压/GPS 海拔的
 * 逐点抖动；窗口按采样间隔自适应换算为点数，限制在 3~51 点。
 */
const ELEV_SMOOTH_TARGET_SEC = 30
const ELEV_SMOOTH_MIN_POINTS = 3
const ELEV_SMOOTH_MAX_POINTS = 51

/**
 * 滞回阈值（米）：平滑海拔从峰值回落超过该值才结算一段爬升（反之结算下降），
 * 抑制高度取整（±0.5m）与漂移噪声造成的假峰谷。
 */
const ELEV_HYSTERESIS_M = 3

/**
 * 坡度门限（%）：相邻点坡度超过该值才允许延伸当前峰/谷——缓坡与漂移噪声
 * 不再无限推高极值，只有真实陡坡参与结算。与设备气压计口径标定：行者码表
 * 210km 样本（设备 totalAscent=1825m）上，本组合输出 1826m（偏差 <1%）；
 * 裸累加为 2818m（虚高 54%）。
 */
const ELEV_GRADE_GATE_PCT = 5

/**
 * 爬升/下降汇总（米）。
 */
interface ElevationProfile {
  elevationGain?: number
  elevationLoss?: number
}

/**
 * 从记录海拔估算累计爬升/下降（无 session 设备值时的回退口径，GPX 主用）。
 *
 * 设备（码表/App）显示的爬升并非相邻点正增量裸累加——原始海拔（尤其取整后
 * 的气压/GPS 高度）在静止与缓坡上布满 ±1m 噪声，裸累加会大幅虚高（实测
 * Strava 导出 GPX：裸累加 2818m vs 设备 1825m）。本函数模拟设备级口径：
 *
 * 1. 滑动平均平滑（窗口 ≈30s 自适应采样间隔）；
 * 2. 滞回状态机：上升段从峰值回落 ≥ELEV_HYSTERESIS_M 才结算爬升，下降段
 *    从谷值反弹 ≥ELEV_HYSTERESIS_M 才结算下降；
 * 3. 坡度门限：相邻点坡度（海拔增量/水平距离）超过 ELEV_GRADE_GATE_PCT
 *    才延伸峰/谷；水平距离优先取累计距离差，缺失时用速度×时间兜底。
 *
 * 全部记录均无海拔时 gain/loss 为 undefined（规格 §25 缺失≠0）：行者等 App
 * 导出的 GPX 不含 <ele>，UI 应显示「—」而非伪造的 +0 m。
 *
 * @param records 标准化逐点记录（依赖海拔；水平距离/速度可选）
 */
function calculateElevationProfile(records: ActivityRecord[]): ElevationProfile {
  const altIdx: number[] = []
  for (let i = 0; i < records.length; i++) {
    if (records[i].altitude !== undefined) {
      altIdx.push(i)
    }
  }
  if (altIdx.length === 0) {
    return {}
  }

  // 采样间隔自适应窗口：中位间隔 ≈1s 时窗宽 31 点（标定值），稀疏轨迹按比例
  // 缩窄；并收敛到序列长度内（短样本不做过头平滑），保持奇数窗
  let window = ELEV_SMOOTH_MAX_POINTS
  if (altIdx.length >= 2 && records[altIdx[1]].timestamp !== undefined) {
    const dts: number[] = []
    for (let k = 1; k < altIdx.length; k++) {
      const dt = records[altIdx[k]].timestamp - records[altIdx[k - 1]].timestamp
      if (dt > 0) {
        dts.push(dt)
      }
    }
    if (dts.length > 0) {
      dts.sort((a, b) => a - b)
      const median = dts[Math.floor(dts.length / 2)]
      window = Math.min(
        ELEV_SMOOTH_MAX_POINTS,
        Math.max(ELEV_SMOOTH_MIN_POINTS, Math.round(ELEV_SMOOTH_TARGET_SEC / median) | 1),
      )
    }
  }
  window = Math.min(window, altIdx.length)
  if (window % 2 === 0) {
    window -= 1
  }

  // 滑动平均平滑海拔（窗口为奇数，端点收缩）
  const alt = altIdx.map((i) => records[i].altitude as number)
  const half = (window - 1) / 2
  const smooth: number[] = new Array(alt.length)
  for (let i = 0; i < alt.length; i++) {
    const from = Math.max(0, i - half)
    const to = Math.min(alt.length - 1, i + half)
    let sum = 0
    for (let k = from; k <= to; k++) {
      sum += alt[k]
    }
    smooth[i] = sum / (to - from + 1)
  }

  // 水平距离差：优先累计距离字段，缺失用速度×时间兜底；两者皆缺失返回
  // undefined（坡度未知，按可通过门限处理，避免爬升被误归零）
  const gapMeters = (k: number): number | undefined => {
    const prev = records[altIdx[k - 1]]
    const curr = records[altIdx[k]]
    if (prev.distance !== undefined && curr.distance !== undefined) {
      return curr.distance - prev.distance
    }
    if (prev.speed !== undefined && curr.timestamp > prev.timestamp) {
      return prev.speed * (curr.timestamp - prev.timestamp)
    }
    return undefined
  }

  // 滞回状态机（up=处于上升段）：结算与坡度门限见常量注释
  let gain = 0
  let loss = 0
  let up = true
  let base = smooth[0] // 当前段起点海拔（上升段起点 / 下降段起点）
  let peak = smooth[0]
  let trough = smooth[0]
  for (let k = 1; k < smooth.length; k++) {
    const e = smooth[k]
    const dd = gapMeters(k)
    const de = e - smooth[k - 1]
    // 坡度：距离差 ≤0.5m（静止漂移级）按 0 防止漂移延伸峰谷；距离未知按
    // 增量方向视为可通过
    const grade =
      dd === undefined ? (de > 0 ? Number.POSITIVE_INFINITY : de < 0 ? Number.NEGATIVE_INFINITY : 0)
      : dd > 0.5 ? (de / dd) * 100
      : 0
    if (up) {
      if (grade >= ELEV_GRADE_GATE_PCT) {
        if (e > peak) {
          peak = e
        }
      } else if (e <= peak - ELEV_HYSTERESIS_M) {
        gain += peak - base
        up = false
        trough = e
        base = e
        peak = e
      }
    } else {
      if (grade <= -ELEV_GRADE_GATE_PCT) {
        if (e < trough) {
          trough = e
        }
      } else if (e >= trough + ELEV_HYSTERESIS_M) {
        loss += base - trough
        up = true
        base = e
        peak = e
      }
    }
  }
  // 尾段未回落的余量按段内净变化结算
  if (up) {
    gain += Math.max(0, peak - base)
  } else {
    loss += Math.max(0, base - trough)
  }

  return { elevationGain: gain, elevationLoss: loss }
}

/**
 * 爬升/下降汇总：session 提供设备预计算值时优先（缺失一侧仅回退该侧），
 * 否则整体走记录估算。
 */
function calculateElevation(
  session: Partial<RawFitSession> | undefined,
  records: ActivityRecord[],
): ElevationProfile {
  if (session?.totalAscent !== undefined && session?.totalDescent !== undefined) {
    return { elevationGain: session.totalAscent, elevationLoss: session.totalDescent }
  }
  const profile = calculateElevationProfile(records)
  return {
    elevationGain: session?.totalAscent ?? profile.elevationGain,
    elevationLoss: session?.totalDescent ?? profile.elevationLoss,
  }
}
