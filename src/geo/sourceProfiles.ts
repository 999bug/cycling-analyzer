/**
 * 轨迹来源（导出方 App）画像与识别。
 *
 * 用户视角是「这个文件是从哪个软件导出来的」，而非坐标系代号——
 * 纠偏 UI 让用户选 App 名称，内部按本表映射到坐标系。
 *
 * 识别依据：GPX 的 <gpx creator> 属性（各类 App 均会写入），
 * 缺失时回退文件名关键词；两者都命中不了则归为「未知」，
 * 按 WGS-84 处理（国际标准默认值），由用户在纠偏面板确认。
 *
 * 注意：纯数学上无法从单点坐标判定坐标系（GCJ-02 偏移场平滑，
 * 两种坐标系下的轨迹形状完全相似），因此来源元数据是唯一可靠依据。
 */

import type { CoordinateSystem } from './coordinateSystem'

/** 来源 App 标识 */
export type SourceAppId =
  | 'cyclingAnalyzer'
  | 'strava'
  | 'garmin'
  | 'wahoo'
  | 'xingzhe'
  | 'xoss'
  | 'heiniao'
  | 'keep'
  | 'gudong'
  | 'yuepaoquan'
  | 'amap'
  | 'tencent'
  | 'huawei'
  | 'xiaomi'
  | 'baidu'
  | 'unknown'

/** 来源画像：一个导出方 App 的展示名与默认坐标系 */
export interface SourceProfile {
  /** 稳定标识（落库存此值，与展示文案解耦） */
  id: SourceAppId

  /** 展示名（纠偏下拉与详情页来源标签用） */
  label: string

  /** 该来源导出文件的默认坐标系 */
  coordinateSystem: CoordinateSystem

  /** creator / 文件名匹配关键词（全小写比较，任一命中即匹配） */
  keywords: readonly string[]
}

/**
 * 来源画像表。
 *
 * 顺序即优先级：更具体的关键词靠前，避免被宽泛词抢先命中。
 * 新增来源只需在此追加一条，UI 与识别逻辑自动生效。
 */
export const SOURCE_PROFILES: readonly SourceProfile[] = [
  { id: 'cyclingAnalyzer', label: '本站导出', coordinateSystem: 'wgs84', keywords: ['cycling-analyzer'] },
  { id: 'strava', label: 'Strava', coordinateSystem: 'wgs84', keywords: ['stravagpx', 'strava'] },
  { id: 'garmin', label: 'Garmin Connect', coordinateSystem: 'wgs84', keywords: ['garmin connect', 'garmin'] },
  { id: 'wahoo', label: 'Wahoo', coordinateSystem: 'wgs84', keywords: ['wahoo', 'elemnt'] },
  // 行者 / XOSS（同属 imxingzhe）：GPX 按 WGS-84 导出（官方称可在 Google Earth 中浏览，
  // 且用户实测行者导出 GPX 按 WGS-84 处理后与高德底图对齐）——早期误标 GCJ-02 已修正
  { id: 'xingzhe', label: '行者', coordinateSystem: 'wgs84', keywords: ['行者', 'xingzhe', 'imxingzhe'] },
  { id: 'xoss', label: 'XOSS', coordinateSystem: 'wgs84', keywords: ['xoss'] },
  // 咕咚：2014-03-24 起由 GCJ-02 升级为 WGS-84（running_page 项目记载），现代导出按 WGS-84
  { id: 'gudong', label: '咕咚', coordinateSystem: 'wgs84', keywords: ['咕咚', 'codoon', 'gudong'] },
  // 悦跑圈：导出数据无需 GCJ 纠偏（running_page joyrun 同步脚本无偏移修正项），按 WGS-84
  { id: 'yuepaoquan', label: '悦跑圈', coordinateSystem: 'wgs84', keywords: ['悦跑圈', 'joyrun', 'yuepaoquan'] },
  // Keep：目前采用 GCJ-02（running_page 项目明确记载其数据在 WGS-84 平台整体偏移）
  { id: 'keep', label: 'Keep', coordinateSystem: 'gcj02', keywords: ['keep'] },
  // 黑鸟：API 返回 GCJ-02（社区同步脚本均需 gcj02→wgs84 转换）
  { id: 'heiniao', label: '黑鸟', coordinateSystem: 'gcj02', keywords: ['黑鸟', 'heiniao', 'blackbird'] },
  // 高德 / 腾讯：地图服务导出的轨迹即为 GCJ-02
  { id: 'amap', label: '高德', coordinateSystem: 'gcj02', keywords: ['amap', 'autonavi', '高德'] },
  { id: 'tencent', label: '腾讯地图', coordinateSystem: 'gcj02', keywords: ['tencent', '腾讯'] },
  // 华为运动健康 / 小米运动（Zepp Life）：导出轨迹为 GCJ-02
  { id: 'huawei', label: '华为运动健康', coordinateSystem: 'gcj02', keywords: ['huawei', '华为', 'hmscore'] },
  { id: 'xiaomi', label: '小米运动', coordinateSystem: 'gcj02', keywords: ['xiaomi', '小米', 'mifit', 'zepp'] },
  { id: 'baidu', label: '百度', coordinateSystem: 'bd09', keywords: ['baidu', '百度'] },
]

/**
 * 未知来源兜底画像：按 WGS-84 处理并提示用户确认。
 *
 * 选 WGS-84 而非 GCJ-02 的理由：FIT 文件恒为 WGS-84（GPS 真值），
 * 且 Garmin / Strava / Wahoo 等国际平台导出同样是 WGS-84；
 * 猜错的代价由纠偏面板兜底（改标记即可，不碰数据）。
 */
export const UNKNOWN_SOURCE: SourceProfile = {
  id: 'unknown',
  label: '未知来源',
  coordinateSystem: 'wgs84',
  keywords: [],
}

/**
 * 坐标系展示名。
 *
 * 代号（WGS-84 / GCJ-02 / BD-09）用户大多不认识，UI 上以中文说明呈现，
 * 并在来源旁边标注「行者 · 默认 GCJ-02」这类可读提示。
 */
export const COORDINATE_SYSTEM_LABELS: Record<CoordinateSystem, string> = {
  wgs84: 'WGS-84（GPS 真值）',
  gcj02: 'GCJ-02（火星坐标）',
  bd09: 'BD-09（百度坐标）',
}

/** 来源匹配结果 */
export interface SourceMatch {
  /** 命中的来源画像（未命中为 UNKNOWN_SOURCE） */
  profile: SourceProfile

  /** 命中途径：creator 属性 / 文件名 / 未命中走默认值 */
  matchedBy: 'creator' | 'fileName' | 'default'
}

/**
 * 按关键词匹配来源画像。
 *
 * @param text 待匹配文本（creator 或文件名）；undefined 视为不匹配
 * @returns 命中的画像；无命中返回 undefined
 */
function matchProfile(text: string | undefined): SourceProfile | undefined {
  if (text === undefined || text.length === 0) {
    return undefined
  }
  const haystack = text.toLowerCase()
  return SOURCE_PROFILES.find((profile) =>
    profile.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())),
  )
}

/**
 * 识别轨迹来源：creator 属性优先，缺失时回退文件名。
 *
 * @param creator GPX <gpx creator> 属性值（FIT 文件传 undefined）
 * @param fileName 源文件名（可选，作为 creator 缺失时的兜底线索）
 * @returns 匹配结果（未命中返回 UNKNOWN_SOURCE，matchedBy 为 'default'）
 */
export function detectSource(creator: string | undefined, fileName?: string): SourceMatch {
  const byCreator = matchProfile(creator)
  if (byCreator !== undefined) {
    return { profile: byCreator, matchedBy: 'creator' }
  }
  const byFileName = matchProfile(fileName)
  if (byFileName !== undefined) {
    return { profile: byFileName, matchedBy: 'fileName' }
  }
  return { profile: UNKNOWN_SOURCE, matchedBy: 'default' }
}

/**
 * 按标识取来源画像（落库值回显用；未知标识回退兜底画像）。
 *
 * @param id 落库的来源标识
 * @returns 对应画像；未找到返回 UNKNOWN_SOURCE
 */
export function sourceProfileById(id: string | undefined): SourceProfile {
  if (id === undefined) {
    return UNKNOWN_SOURCE
  }
  return SOURCE_PROFILES.find((profile) => profile.id === id) ?? UNKNOWN_SOURCE
}

/**
 * 按坐标系分组全部来源（纠偏下拉分组展示用）。
 *
 * @returns 坐标系 → 该档下的来源画像列表（顺序为 wgs84 / gcj02 / bd09）
 */
export function groupSourcesBySystem(): Array<{ system: CoordinateSystem; profiles: SourceProfile[] }> {
  const order: CoordinateSystem[] = ['wgs84', 'gcj02', 'bd09']
  return order.map((system) => ({
    system,
    profiles: SOURCE_PROFILES.filter((profile) => profile.coordinateSystem === system),
  }))
}
