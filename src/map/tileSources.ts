/**
 * 地图瓦片源定义与底图坐标系判定。
 *
 * 高德为默认瓦片源（境内访问稳定快速）；高德不可用时降级到 OSM。
 * 高德瓦片基于 GCJ-02（火星坐标），轨迹叠加前需投影到该坐标系；
 * OSM 为 WGS-84 原样展示。源标识用语义字符串存储记忆，调换顺序互不干扰。
 *
 * 坐标系换算实现统一在 @/geo/coordinateSystem（本模块不再重复实现），
 * 展示投影统一走 @/geo/projection 的 projectPoint，避免各处自行判断而漏改。
 */

import type { CoordinateSystem } from '@/geo/coordinateSystem'

/** 瓦片源配置（Leaflet TileLayer 参数） */
export interface TileSource {
  /** 瓦片 URL 模板（{s} 子域 / {x} / {y} / {z} 占位符） */
  url: string

  /** 子域名列表 */
  subdomains: string[]

  /** 版权署名 */
  attribution: string

  /** 底图坐标系（轨迹叠加前需投影到该坐标系） */
  system: CoordinateSystem
}

/** 连续瓦片加载失败达该次数后触发降级（期间有瓦片成功则重新计数） */
export const FALLBACK_TILE_ERROR_THRESHOLD = 3

/** 瓦片降级状态记忆 key（sessionStorage：本会话内直接使用降级源，不再重试默认源） */
export const TILE_FALLBACK_STORAGE_KEY = 'cycling-map-tile-fallback'

/** 高德栅格瓦片的负载均衡子域（01~04） */
const AMAP_SUBDOMAINS = ['1', '2', '3', '4']

/** 高德矢量底图（路网 + 注记，不透明调色板 PNG）：默认源与「正常」模式共用同一地址 */
const AMAP_VECTOR_TILE_URL =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'

/** 高德卫星影像底图（JPEG，不含路网与注记） */
const AMAP_SATELLITE_TILE_URL =
  'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'

/**
 * 高德路网注记叠加层（RGBA PNG，实测 80% 像素全透明）：叠在影像底图上即「卫星 + 路网」。
 * 注意与矢量底图的 style=8 同名不同域——webst 域名下 style=8 才是透明注记层。
 */
const AMAP_SATELLITE_LABELS_TILE_URL =
  'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}'

/** 瓦片源列表：索引 0 为默认源（高德），后续为自动降级顺序 */
export const TILE_SOURCES: TileSource[] = [
  {
    url: AMAP_VECTOR_TILE_URL,
    subdomains: AMAP_SUBDOMAINS,
    attribution: '&copy; 高德地图',
    system: 'gcj02',
  },
  {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    system: 'wgs84',
  },
]

/**
 * 地图显示模式（底图样式）：全部走高德同一套栅格瓦片，坐标系一致（GCJ-02），
 * 因此切换模式**不需要重新投影轨迹**，轨迹与底图始终对齐。
 *
 * 参数取自高德栅格瓦片服务的实测结果（详见 docs/PROGRESS.md §5）：
 * - `webrd0{1-4}` + `style=8`：不透明矢量底图 + 路网 + 注记（默认「正常」）；
 * - `webst0{1-4}` + `style=6`：卫星影像，无路网无注记；
 * - `webst0{1-4}` + `style=8`：纯路网注记叠加层（透明），与影像底图叠加得「卫星 + 路网」。
 *
 * 说明：曾用的 OpenTopoMap 地形层已移除——境外 OSM 系服务国内基本加载不出（点了没反应），
 * 且它是 WGS-84 而底图/轨迹为 GCJ-02，即便加载成功也会整体错位；亦不在合规定位白名单内。
 */
export type MapMode = 'normal' | 'satellite' | 'satelliteRoads'

/** 单张瓦片图层（一个模式由一个底图层 + 可选叠加层组成） */
export interface MapModeLayer {
  /** 瓦片 URL 模板 */
  url: string

  /** 子域名列表 */
  subdomains: string[]

  /** 图层不透明度（缺省 1；注记叠加层本身已是透明 PNG，无需调透明度） */
  opacity?: number
}

/** 地图显示模式定义 */
export interface MapModeDefinition {
  /** 模式标识（持久化值） */
  id: MapMode

  /** 按钮文案 */
  label: string

  /** 图层栈：索引 0 为底图，其后为叠加层 */
  layers: readonly MapModeLayer[]
}

/** 可选地图模式（顺序即控制条按钮顺序，首个为默认） */
export const MAP_MODES: readonly MapModeDefinition[] = [
  {
    id: 'normal',
    label: '正常',
    layers: [{ url: AMAP_VECTOR_TILE_URL, subdomains: AMAP_SUBDOMAINS }],
  },
  {
    id: 'satellite',
    label: '卫星',
    layers: [{ url: AMAP_SATELLITE_TILE_URL, subdomains: AMAP_SUBDOMAINS }],
  },
  {
    id: 'satelliteRoads',
    label: '卫星+路网',
    layers: [
      { url: AMAP_SATELLITE_TILE_URL, subdomains: AMAP_SUBDOMAINS },
      { url: AMAP_SATELLITE_LABELS_TILE_URL, subdomains: AMAP_SUBDOMAINS },
    ],
  },
]

/** 地图模式持久化 key（localStorage：与地图高度同为用户偏好，跨会话保留） */
export const MAP_MODE_STORAGE_KEY = 'cycling-map-mode'

/** 默认地图模式（无记忆/记忆无效时使用） */
const DEFAULT_MAP_MODE: MapMode = 'normal'

/**
 * 取地图模式定义（未知值回退默认模式）。
 *
 * @param mode 模式标识
 */
export function mapModeOf(mode: MapMode): MapModeDefinition {
  return MAP_MODES.find((definition) => definition.id === mode) ?? MAP_MODES[0]!
}

/**
 * 从 localStorage 读取记忆的地图模式（无记忆/无效值/存储不可用均回退默认）。
 */
export function loadStoredMapMode(): MapMode {
  try {
    const raw = localStorage.getItem(MAP_MODE_STORAGE_KEY)
    return MAP_MODES.some((definition) => definition.id === raw) ? (raw as MapMode) : DEFAULT_MAP_MODE
  } catch {
    return DEFAULT_MAP_MODE
  }
}

/**
 * 记忆地图模式到 localStorage（存储不可用时静默忽略，不影响切换本身）。
 *
 * @param mode 模式标识
 */
export function storeMapMode(mode: MapMode): void {
  try {
    localStorage.setItem(MAP_MODE_STORAGE_KEY, mode)
  } catch {
    // 隐私模式等场景下写入失败：仅失去记忆能力，本次切换仍然生效
  }
}

/** 瓦片源标识（与 TILE_SOURCES 同序；sessionStorage 记忆值用语义字符串而非索引） */
type TileSourceId = 'amap' | 'osm'

const SOURCE_IDS: readonly TileSourceId[] = ['amap', 'osm']

/** 瓦片源索引 → 语义标识（未知索引回退默认源） */
function tileSourceId(sourceIndex: number): TileSourceId {
  return SOURCE_IDS[sourceIndex] ?? SOURCE_IDS[0]!
}

/**
 * 取瓦片源的底图坐标系（轨迹叠加的目标坐标系）。
 *
 * @param sourceIndex TILE_SOURCES 下标
 * @returns 该底图所用坐标系（未知索引回退默认源）
 */
export function mapSystem(sourceIndex: number): CoordinateSystem {
  return TILE_SOURCES[sourceIndex]?.system ?? TILE_SOURCES[0]!.system
}

/**
 * 判断瓦片源是否基于 GCJ-02（高德）：轨迹叠加前需投影纠偏。
 *
 * @param sourceIndex TILE_SOURCES 下标
 */
export function isGcjSource(sourceIndex: number): boolean {
  return mapSystem(sourceIndex) === 'gcj02'
}

/**
 * 从 sessionStorage 读取记忆的瓦片源索引（无记忆/无效值返回默认源 0）。
 *
 * 记忆值为语义标识（'amap'/'osm'），调换源顺序后旧记忆仍正确解析。
 */
export function loadStoredSourceIndex(): number {
  const raw = sessionStorage.getItem(TILE_FALLBACK_STORAGE_KEY)
  if (raw === null) {
    return 0
  }
  const index = SOURCE_IDS.indexOf(raw as TileSourceId)
  return index >= 0 ? index : 0
}

/**
 * 记忆当前瓦片源到 sessionStorage（本会话内后续地图直接复用）。
 *
 * @param sourceIndex TILE_SOURCES 下标
 */
export function storeSourceIndex(sourceIndex: number): void {
  sessionStorage.setItem(TILE_FALLBACK_STORAGE_KEY, tileSourceId(sourceIndex))
}

// 坐标系换算已迁至 @/geo/coordinateSystem，此处再导出以兼容既有调用方与测试
export { wgs84ToGcj02 } from '@/geo/coordinateSystem'
