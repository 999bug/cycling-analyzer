/**
 * FIT 标准化：解码结果 → 领域模型 Activity。
 *
 * 职责（规格 §42）：将 Garmin SDK 的消息结构转换为项目领域模型，
 * 包括半周 → 十进制度、Date → Unix 秒、字段缺失容错。
 * UI 层只依赖本模块输出的 Activity，不接触 SDK 数据结构。
 */
import { calculateSummary } from '@/fit/calculator/calculator'
import type { DecodedFitFile, RawFitRecord } from '@/fit/decoder/fitDecoder'
import type { Activity, ActivityRecord, DeviceInfo } from '@/types/activity'

/** 半周 → 十进制度系数（FIT 协议：2^31 半周 = 180 度） */
const SEMICIRCLE_TO_DEGREES = 180 / 2147483648

/**
 * 标准化所需的源文件元信息（导入时提供）。
 */
export interface NormalizeMeta {
  /** 活动唯一标识 */
  id: string
  /** 源文件名 */
  fileName: string
  /** 文件内容指纹（SHA-256） */
  fingerprint: string
}

/**
 * 将解码的 FIT 数据标准化为 Activity。
 *
 * @param fit 解码结果
 * @param meta 源文件元信息
 * @returns 完整 Activity（含 records 与统计字段）
 */
export function normalizeActivity(fit: DecodedFitFile, meta: NormalizeMeta): Activity {
  const session = fit.sessions[0]
  const records = fit.records.map(toActivityRecord)
  const summary = calculateSummary(records, session)

  return {
    id: meta.id,
    fileId: buildFileId(fit),
    fileName: meta.fileName,
    fingerprint: meta.fingerprint,
    activityType: session?.sport ?? '',
    startTime: toIsoString(session?.startTime ?? records[0]?.timestamp),
    endTime: toIsoString(session?.timestamp ?? records[records.length - 1]?.timestamp),
    duration: summary.duration,
    elapsedTime: summary.elapsedTime,
    distance: summary.distance,
    elevationGain: summary.elevationGain,
    elevationLoss: summary.elevationLoss,
    calories: summary.calories,
    avgSpeed: summary.avgSpeed,
    maxSpeed: summary.maxSpeed,
    avgHeartRate: summary.avgHeartRate,
    maxHeartRate: summary.maxHeartRate,
    avgCadence: summary.avgCadence,
    maxCadence: summary.maxCadence,
    avgPower: summary.avgPower,
    maxPower: summary.maxPower,
    aerobicTrainingEffect: session?.aerobicTrainingEffect,
    anaerobicTrainingEffect: session?.anaerobicTrainingEffect,
    device: toDeviceInfo(fit.device),
    records,
  }
}

/** 半周位置 → 十进制度（0 或无值表示无有效坐标） */
function toDegrees(semicircles: number | undefined): number | undefined {
  if (semicircles === undefined || semicircles === 0) {
    return undefined
  }
  return semicircles * SEMICIRCLE_TO_DEGREES
}

/** 解码记录 → 领域记录（单位标准化） */
function toActivityRecord(raw: RawFitRecord): ActivityRecord {
  return {
    timestamp: raw.timestamp,
    latitude: toDegrees(raw.positionLat),
    longitude: toDegrees(raw.positionLong),
    altitude: raw.altitude ?? raw.enhancedAltitude,
    distance: raw.distance,
    speed: raw.speed ?? raw.enhancedSpeed,
    heartRate: raw.heartRate,
    cadence: raw.cadence,
    power: raw.power,
    temperature: raw.temperature,
  }
}

/** Unix 秒 → ISO 8601 字符串（无有效时间时返回空串） */
function toIsoString(unixSeconds: number | undefined): string {
  if (unixSeconds === undefined || unixSeconds <= 0) {
    return ''
  }
  return new Date(unixSeconds * 1000).toISOString()
}

/**
 * 生成文件标识：序列号 + 创建时间（同一设备同一时刻唯一），
 * 两者缺失时回退为文件类型。
 */
function buildFileId(fit: DecodedFitFile): string {
  const serial = fit.fileId.serialNumber
  const created = fit.fileId.timeCreated
  if (serial !== undefined && created !== undefined) {
    return `${serial}-${created}`
  }
  return fit.fileId.type ?? ''
}

/** 设备信息映射（字段缺失时省略） */
function toDeviceInfo(device: DecodedFitFile['device']): DeviceInfo | undefined {
  if (!device) {
    return undefined
  }
  return {
    manufacturer: device.manufacturer,
    product: device.product,
    productName: device.productName,
    serialNumber: device.serialNumber,
    softwareVersion: device.softwareVersion,
  }
}
