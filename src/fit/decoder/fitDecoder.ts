/**
 * FIT 解码器：封装 @garmin/fitsdk，负责文件识别、完整性校验与消息提取。
 *
 * 模块边界（规格 §42）：React 组件不得直接调用此模块之外的 Garmin SDK，
 * 统一经由 Decoder → Normalizer → Calculator → Storage → UI 链路。
 *
 * 注意：Decoder 的 isFIT/checkIntegrity 会消费 Stream，必须在 read 之前调用。
 */
import { Decoder, Stream } from '@garmin/fitsdk'
import { CorruptedFitError, NotFitFileError } from '@/fit/decoder/errors'

// 错误类从 errors.ts 移出（避免错误类引用把 fitsdk 拉进主包），此处再导出保持兼容
export { CorruptedFitError, FitParseError, NotFitFileError } from '@/fit/decoder/errors'

/**
 * 解码后的逐点记录（时间已转 Unix 秒，位置仍为半周，其余为物理单位）。
 */
export interface RawFitRecord {
  /** 时间（Unix 秒） */
  timestamp: number
  /** 纬度（半周） */
  positionLat?: number
  /** 经度（半周） */
  positionLong?: number
  /** 累计距离（米） */
  distance?: number
  /** 速度（m/s） */
  speed?: number
  /** 增强速度（m/s，精度更高时使用） */
  enhancedSpeed?: number
  /** 海拔（米） */
  altitude?: number
  /** 增强海拔（米） */
  enhancedAltitude?: number
  /** 心率（bpm） */
  heartRate?: number
  /** 踏频（rpm） */
  cadence?: number
  /** 功率（W） */
  power?: number
  /** 温度（摄氏度） */
  temperature?: number
}

/**
 * 解码后的会话汇总（时间已转 Unix 秒）。
 */
export interface RawFitSession {
  /** 会话结束时间（Unix 秒） */
  timestamp: number
  /** 会话开始时间（Unix 秒） */
  startTime: number
  /** 总耗时（秒，含暂停） */
  totalElapsedTime?: number
  /** 计时时长（秒） */
  totalTimerTime?: number
  /** 总距离（米） */
  totalDistance?: number
  /** 累计爬升（米） */
  totalAscent?: number
  /** 累计下降（米） */
  totalDescent?: number
  /** 消耗卡路里 */
  totalCalories?: number
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
  /** 运动类型（如 cycling） */
  sport?: string
  /** 子运动类型 */
  subSport?: string
  /** 圈数 */
  numLaps?: number
}

/**
 * 解码后的圈数据（字段从简，后续版本扩展）。
 */
export interface RawFitLap {
  /** 圈开始时间（Unix 秒） */
  startTime: number
  /** 圈结束时间（Unix 秒） */
  timestamp: number
  /** 圈距离（米） */
  totalDistance?: number
}

/**
 * FIT 文件解码结果。
 */
export interface DecodedFitFile {
  /** 文件标识信息 */
  fileId: {
    /** 文件类型（如 activity） */
    type?: string
    /** 厂商 */
    manufacturer?: string
    /** 产品 ID */
    product?: string
    /** 序列号 */
    serialNumber?: number
    /** 创建时间（Unix 秒） */
    timeCreated?: number
  }
  /** 设备信息 */
  device?: {
    manufacturer?: string
    product?: string
    productName?: string
    serialNumber?: number
    softwareVersion?: number
  }
  /** 逐点记录 */
  records: RawFitRecord[]
  /** 会话 */
  sessions: RawFitSession[]
  /** 圈数据 */
  laps: RawFitLap[]
  /** 活动汇总 */
  activity?: {
    numSessions?: number
    totalTimerTime?: number
  }
  /** 解码过程中的警告（不阻断解析） */
  errors: unknown[]
}

/**
 * 判断字节流是否为 FIT 文件。
 */
export function isFitFile(bytes: ArrayBuffer): boolean {
  try {
    return Decoder.isFIT(Stream.fromArrayBuffer(bytes))
  } catch {
    return false
  }
}

/**
 * 校验 FIT 文件完整性（CRC）。
 */
export function checkFitIntegrity(bytes: ArrayBuffer): boolean {
  try {
    return new Decoder(Stream.fromArrayBuffer(bytes)).checkIntegrity()
  } catch {
    return false
  }
}

/**
 * 解码 FIT 文件。
 *
 * @throws NotFitFileError 不是有效的 FIT 文件
 * @throws CorruptedFitError FIT 完整性校验失败
 */
export function decodeFit(bytes: ArrayBuffer): DecodedFitFile {
  const stream = Stream.fromArrayBuffer(bytes)
  const decoder = new Decoder(stream)

  if (!decoder.isFIT()) {
    throw new NotFitFileError()
  }
  if (!decoder.checkIntegrity()) {
    throw new CorruptedFitError()
  }

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  })

  return {
    fileId: toFileId(asRecord(messages.fileIdMesgs?.[0])),
    device: toDeviceInfo(asRecord(messages.deviceInfoMesgs?.[0])),
    records: toRecords((messages.recordMesgs ?? []).map(asRecord)),
    sessions: toSessions((messages.sessionMesgs ?? []).map(asRecord)),
    laps: toLaps((messages.lapMesgs ?? []).map(asRecord)),
    activity: toActivity(asRecord(messages.activityMesgs?.[0])),
    errors,
  }
}

/** SDK 消息为强类型对象，转为宽松记录以便按字段名提取 */
function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>
}

/** FIT 时间基准偏移（1989-12-31T00:00:00Z），SDK 已加回，此处仅做 Date → 秒转换 */
function toUnixSeconds(value: unknown): number | undefined {
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000)
  }
  if (typeof value === 'number') {
    return value
  }
  return undefined
}

/** 提取 fileId 消息 */
function toFileId(mesg: Record<string, unknown> | undefined): DecodedFitFile['fileId'] {
  if (!mesg) {
    return {}
  }
  return {
    type: typeof mesg.type === 'string' ? mesg.type : undefined,
    manufacturer: typeof mesg.manufacturer === 'string' ? mesg.manufacturer : undefined,
    product: typeof mesg.product === 'string' ? mesg.product : undefined,
    serialNumber: typeof mesg.serialNumber === 'number' ? mesg.serialNumber : undefined,
    timeCreated: toUnixSeconds(mesg.timeCreated),
  }
}

/** 提取 deviceInfo 消息 */
function toDeviceInfo(mesg: Record<string, unknown> | undefined): DecodedFitFile['device'] {
  if (!mesg) {
    return undefined
  }
  return {
    manufacturer: typeof mesg.manufacturer === 'string' ? mesg.manufacturer : undefined,
    product: typeof mesg.product === 'string' ? mesg.product : undefined,
    productName: typeof mesg.productName === 'string' ? mesg.productName : undefined,
    serialNumber: typeof mesg.serialNumber === 'number' ? mesg.serialNumber : undefined,
    softwareVersion: typeof mesg.softwareVersion === 'number' ? mesg.softwareVersion : undefined,
  }
}

/** 提取 record 消息（丢弃无时间戳的记录） */
function toRecords(mesgs: Record<string, unknown>[]): RawFitRecord[] {
  const records: RawFitRecord[] = []
  for (const mesg of mesgs) {
    const timestamp = toUnixSeconds(mesg.timestamp)
    if (timestamp === undefined) {
      continue
    }
    records.push({
      timestamp,
      positionLat: asNumber(mesg.positionLat),
      positionLong: asNumber(mesg.positionLong),
      distance: asNumber(mesg.distance),
      speed: asNumber(mesg.speed),
      enhancedSpeed: asNumber(mesg.enhancedSpeed),
      altitude: asNumber(mesg.altitude),
      enhancedAltitude: asNumber(mesg.enhancedAltitude),
      heartRate: asNumber(mesg.heartRate),
      cadence: asNumber(mesg.cadence),
      power: asNumber(mesg.power),
      temperature: asNumber(mesg.temperature),
    })
  }
  return records
}

/** 提取 session 消息 */
function toSessions(mesgs: Record<string, unknown>[]): RawFitSession[] {
  return mesgs.map((mesg) => ({
    timestamp: toUnixSeconds(mesg.timestamp) ?? 0,
    startTime: toUnixSeconds(mesg.startTime) ?? 0,
    totalElapsedTime: asNumber(mesg.totalElapsedTime),
    totalTimerTime: asNumber(mesg.totalTimerTime),
    totalDistance: asNumber(mesg.totalDistance),
    totalAscent: asNumber(mesg.totalAscent),
    totalDescent: asNumber(mesg.totalDescent),
    totalCalories: asNumber(mesg.totalCalories),
    avgSpeed: asNumber(mesg.avgSpeed),
    maxSpeed: asNumber(mesg.maxSpeed),
    avgHeartRate: asNumber(mesg.avgHeartRate),
    maxHeartRate: asNumber(mesg.maxHeartRate),
    avgCadence: asNumber(mesg.avgCadence),
    maxCadence: asNumber(mesg.maxCadence),
    avgPower: asNumber(mesg.avgPower),
    maxPower: asNumber(mesg.maxPower),
    sport: typeof mesg.sport === 'string' ? mesg.sport : undefined,
    subSport: typeof mesg.subSport === 'string' ? mesg.subSport : undefined,
    numLaps: asNumber(mesg.numLaps),
  }))
}

/** 提取 lap 消息 */
function toLaps(mesgs: Record<string, unknown>[]): RawFitLap[] {
  return mesgs
    .map((mesg) => ({
      startTime: toUnixSeconds(mesg.startTime) ?? 0,
      timestamp: toUnixSeconds(mesg.timestamp) ?? 0,
      totalDistance: asNumber(mesg.totalDistance),
    }))
    .filter((lap) => lap.timestamp > 0)
}

/** 提取 activity 消息 */
function toActivity(mesg: Record<string, unknown> | undefined): DecodedFitFile['activity'] {
  if (!mesg) {
    return undefined
  }
  return {
    numSessions: asNumber(mesg.numSessions),
    totalTimerTime: asNumber(mesg.totalTimerTime),
  }
}

/** 仅保留有限数字（排除 NaN/Infinity），字段缺失时为 undefined */
function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return value
}
