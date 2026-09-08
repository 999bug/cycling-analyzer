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

/** 瓦片源列表：索引 0 为默认源（高德），后续为自动降级顺序 */
export const TILE_SOURCES: TileSource[] = [
  {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
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
