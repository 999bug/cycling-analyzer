/**
 * 用户设置（规格 §27）：类型定义、键值规范、读写封装与单位换算。
 *
 * 设置键规范（settings 表键值对，后续 P1-6 FTP/心率区间计算依赖本格式）：
 * - 'profile'：UserProfile 对象（全字段可选，未设置的字段不写入）
 * - 'units'：UnitPreferences 对象（始终包含完整默认值）
 * 一个设置域一个键、值为整个对象；saveSettings 按域合并保存，
 * 只覆盖传入字段，未涉及的字段保留原值。
 *
 * 单位约定：数据存储永远使用公制（距离米，规格 §11/§27），
 * 英里仅作为显示层换算（convertDistance / formatDistanceByUnit）。
 */
import { DexieSettingsRepository, type SettingsRepository } from '@/storage/repositories/settingsRepository'
import { db } from '@/storage/db'

/** 距离单位（仅影响显示，存储永远是公制） */
export type DistanceUnit = 'km' | 'mi'

/** 时间格式（仅影响显示） */
export type TimeFormat = '24h' | '12h'

/** 主题（规格 §36，默认深色；system = 跟随系统偏好） */
export type Theme = 'dark' | 'light' | 'system'

/**
 * 个人信息（规格 §27）。
 * 数字字段单位：体重 kg、身高 cm、FTP/心率 bpm 用 W/bpm。
 */
export interface UserProfile {
  /** 昵称 */
  nickname?: string

  /** 体重（kg） */
  weightKg?: number

  /** 身高（cm） */
  heightCm?: number

  /** 功能阈值功率（W） */
  ftp?: number

  /** 最大心率（bpm） */
  maxHeartRate?: number

  /** 静息心率（bpm） */
  restingHeartRate?: number
}

/** 单位偏好（规格 §27，默认公制） */
export interface UnitPreferences {
  /** 距离单位（默认公里） */
  distance: DistanceUnit

  /** 时间格式（默认 24 小时制） */
  timeFormat: TimeFormat
}

/** 外观偏好（规格 §36） */
export interface AppearancePreferences {
  /** 主题（默认深色） */
  theme: Theme
}

/** 导入偏好（规格 §19） */
export interface ImportPreferences {
  /** 是否保存原始 FIT 文件字节（默认不保存，占用浏览器存储空间） */
  saveOriginalFit: boolean
}

/** 离线偏好（离线地图） */
export interface OfflinePreferences {
  /** 是否启用瓦片 IndexedDB 缓存（默认开启，离线/弱网时地图可用） */
  tileCacheEnabled: boolean
}

/** 完整设置数据（getSettings 返回） */
export interface SettingsData {
  /** 个人信息 */
  profile: UserProfile

  /** 单位偏好 */
  units: UnitPreferences

  /** 外观偏好 */
  appearance: AppearancePreferences

  /** 导入偏好 */
  import: ImportPreferences

  /** 离线偏好 */
  offline: OfflinePreferences
}

/** 设置保存片段（按域合并保存，未提供的字段保留原值） */
export interface SettingsPatch {
  /** 个人信息（可只传需更新的字段） */
  profile?: Partial<UserProfile>

  /** 单位偏好（可只传需更新的字段） */
  units?: Partial<UnitPreferences>

  /** 外观偏好（可只传需更新的字段） */
  appearance?: Partial<AppearancePreferences>

  /** 导入偏好（可只传需更新的字段） */
  import?: Partial<ImportPreferences>

  /** 离线偏好（可只传需更新的字段） */
  offline?: Partial<OfflinePreferences>
}

/** profile 设置键（settings 表） */
export const PROFILE_KEY = 'profile'

/** units 设置键（settings 表） */
export const UNITS_KEY = 'units'

/** appearance 设置键（settings 表） */
export const APPEARANCE_KEY = 'appearance'

/** import 设置键（settings 表） */
export const IMPORT_KEY = 'import'

/** offline 设置键（settings 表） */
export const OFFLINE_KEY = 'offline'

/** 默认单位偏好（规格 §27 默认全公制） */
export const DEFAULT_UNITS: UnitPreferences = { distance: 'km', timeFormat: '24h' }

/** 默认外观偏好（规格 §36 默认深色） */
export const DEFAULT_APPEARANCE: AppearancePreferences = { theme: 'dark' }

/** 默认导入偏好（规格 §19 默认不保存原始文件） */
export const DEFAULT_IMPORT: ImportPreferences = { saveOriginalFit: false }

/** 默认离线偏好（默认开启瓦片缓存） */
export const DEFAULT_OFFLINE: OfflinePreferences = { tileCacheEnabled: true }

/** 默认个人信息（全字段未设置） */
export const DEFAULT_PROFILE: UserProfile = {}

/** 1 英里对应的米数 */
export const METERS_PER_MILE = 1609.344

/** 默认设置仓库（全局数据库单例） */
const defaultSettingsRepository = new DexieSettingsRepository(db)

/**
 * 读取全部设置（未设置的域返回默认值）。
 *
 * @param settingsRepository 设置仓库（测试注入独立实例）
 * @returns 完整设置数据
 */
export async function getSettings(
  settingsRepository: SettingsRepository = defaultSettingsRepository,
): Promise<SettingsData> {
  const [profileRaw, unitsRaw, appearanceRaw, importRaw, offlineRaw] = await Promise.all([
    settingsRepository.get(PROFILE_KEY),
    settingsRepository.get(UNITS_KEY),
    settingsRepository.get(APPEARANCE_KEY),
    settingsRepository.get(IMPORT_KEY),
    settingsRepository.get(OFFLINE_KEY),
  ])
  return {
    profile: { ...DEFAULT_PROFILE, ...asRecord(profileRaw) },
    units: { ...DEFAULT_UNITS, ...asRecord(unitsRaw) },
    appearance: { ...DEFAULT_APPEARANCE, ...asRecord(appearanceRaw) },
    import: { ...DEFAULT_IMPORT, ...asRecord(importRaw) },
    offline: { ...DEFAULT_OFFLINE, ...asRecord(offlineRaw) },
  }
}

/**
 * 合并保存设置：只覆盖传入的域与字段，其余保留原值。
 * 例如 saveSettings({ profile: { ftp: 250 } }) 不会丢失已保存的昵称。
 *
 * @param patch 待保存的设置片段
 * @param settingsRepository 设置仓库（测试注入独立实例）
 */
export async function saveSettings(
  patch: SettingsPatch,
  settingsRepository: SettingsRepository = defaultSettingsRepository,
): Promise<void> {
  const current = await getSettings(settingsRepository)
  if (patch.profile !== undefined) {
    await settingsRepository.set(PROFILE_KEY, { ...current.profile, ...patch.profile })
  }
  if (patch.units !== undefined) {
    await settingsRepository.set(UNITS_KEY, { ...current.units, ...patch.units })
  }
  if (patch.appearance !== undefined) {
    await settingsRepository.set(APPEARANCE_KEY, { ...current.appearance, ...patch.appearance })
  }
  if (patch.import !== undefined) {
    await settingsRepository.set(IMPORT_KEY, { ...current.import, ...patch.import })
  }
  if (patch.offline !== undefined) {
    await settingsRepository.set(OFFLINE_KEY, { ...current.offline, ...patch.offline })
  }
}

/**
 * 距离换算：米 → 目标单位数值（存储永远公制，显示层使用）。
 *
 * @param meters 距离（米）
 * @param unit 目标显示单位
 * @returns 换算后的数值（公里或英里）
 */
export function convertDistance(meters: number, unit: DistanceUnit): number {
  if (unit === 'mi') {
    return meters / METERS_PER_MILE
  }
  return meters / 1000
}

/**
 * 按单位格式化距离（显示层）：
 * - 公里：小于 1 km 显示整数米，否则显示 2 位小数千米
 * - 英里：显示 2 位小数英里
 * 无效输入返回占位符 '—'（与 utils/format 约定一致）。
 *
 * @param meters 距离（米，可为空）
 * @param unit 显示单位
 * @returns 格式化字符串，如 '82.31 km' / '51.18 mi' / '—'
 */
export function formatDistanceByUnit(meters: number | null | undefined, unit: DistanceUnit): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) {
    return '—'
  }
  if (unit === 'mi') {
    return `${convertDistance(meters, 'mi').toFixed(2)} mi`
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return `${convertDistance(meters, 'km').toFixed(2)} km`
}

/** 1 m/s 对应的英里每小时 */
const MPS_TO_MPH = 2.23694

/**
 * 按单位格式化速度（显示层）：距离单位决定速度单位（km/h 或 mph）。
 *
 * @param mps 速度（m/s，可为空）
 * @param unit 距离显示单位
 * @returns 格式化字符串，如 '24.5 km/h' / '15.2 mph' / '—'
 */
export function formatSpeedByUnit(mps: number | null | undefined, unit: DistanceUnit): string {
  if (typeof mps !== 'number' || !Number.isFinite(mps)) {
    return '—'
  }
  if (unit === 'mi') {
    return `${(mps * MPS_TO_MPH).toFixed(1)} mph`
  }
  return `${(mps * 3.6).toFixed(1)} km/h`
}

/**
 * 将未知值收窄为记录类型（仅合并纯对象，防御脏数据/结构损坏）。
 *
 * @param value 未知值
 * @returns 记录类型，非纯对象时返回空对象
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
