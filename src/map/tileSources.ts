/**
 * 地图瓦片源定义与坐标转换（WGS-84 → GCJ-02）。
 *
 * OSM 为默认瓦片源；国内直连 OSM 失败时降级到高德瓦片。
 * 高德瓦片基于 GCJ-02（火星坐标），展示前需将 WGS-84 轨迹坐标转换对齐。
 */

/** 瓦片源配置（Leaflet TileLayer 参数） */
export interface TileSource {
  /** 瓦片 URL 模板（{s} 子域 / {x} / {y} / {z} 占位符） */
  url: string
  /** 子域名列表 */
  subdomains: string[]
  /** 版权署名 */
  attribution: string
}

/** 连续瓦片加载失败达该次数后触发降级（期间有瓦片成功则重新计数） */
export const FALLBACK_TILE_ERROR_THRESHOLD = 3

/** 瓦片降级状态记忆 key（sessionStorage：本会话内直接使用降级源，不再重试 OSM） */
export const TILE_FALLBACK_STORAGE_KEY = 'cycling-map-tile-fallback'

/** 瓦片源列表：索引 0 为默认源，后续为自动降级顺序 */
export const TILE_SOURCES: TileSource[] = [  {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  },
]

// ---- WGS-84 → GCJ-02 转换（标准火星坐标加密算法） ----

/** 克氏椭球长半轴（米） */
const GCJ_A = 6378245.0

/** 克氏椭球偏心率平方（17 位有效数字，超出 double 精度的位数运行时同样会被舍入） */
const GCJ_EE = 0.006693421622965943

/** 中国境内判定经度范围（度） */
const CHINA_LNG_MIN = 72.004

/** 中国境内判定经度上限（度） */
const CHINA_LNG_MAX = 137.8347

/** 中国境内判定纬度下限（度） */
const CHINA_LAT_MIN = 0.8293

/** 中国境内判定纬度上限（度） */
const CHINA_LAT_MAX = 55.8271

/**
 * 纬度偏移计算（标准 GCJ-02 加密算法）。
 *
 * @param lng 经度（已平移）
 * @param lat 纬度（已平移）
 * @returns 纬度偏移量（度）
 */
function transformLat(lng: number, lat: number): number {
  let ret =
    -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lat * Math.PI) + 40.0 * Math.sin((lat / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((lat / 12.0) * Math.PI) + 320.0 * Math.sin((lat * Math.PI) / 30.0)) * 2.0) / 3.0
  return ret
}

/**
 * 经度偏移计算（标准 GCJ-02 加密算法）。
 *
 * @param lng 经度（已平移）
 * @param lat 纬度（已平移）
 * @returns 经度偏移量（度）
 */
function transformLng(lng: number, lat: number): number {
  let ret =
    300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lng * Math.PI) + 40.0 * Math.sin((lng / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((lng / 12.0) * Math.PI) + 300.0 * Math.sin((lng / 30.0) * Math.PI)) * 2.0) / 3.0
  return ret
}

/**
 * 判断坐标是否在中国境内（境外不加密，原样返回）。
 *
 * @param lng 经度（十进制度）
 * @param lat 纬度（十进制度）
 * @returns 是否在中国境外
 */
function outOfChina(lng: number, lat: number): boolean {
  return lng < CHINA_LNG_MIN || lng > CHINA_LNG_MAX || lat < CHINA_LAT_MIN || lat > CHINA_LAT_MAX
}

/**
 * WGS-84 坐标转换为 GCJ-02（火星坐标）。
 * 高德底图基于 GCJ-02，轨迹叠加前必须转换对齐，否则偏移数百米。
 * 中国境外坐标不做加密，原样返回。返回对象保留输入对象的其余字段（如 timestamp）。
 *
 * @param point WGS-84 坐标（十进制度）
 * @returns GCJ-02 坐标（十进制度，其余字段原样保留）
 */
export function wgs84ToGcj02<T extends { longitude: number; latitude: number }>(point: T): T {
  const { longitude: lng, latitude: lat } = point

  if (outOfChina(lng, lat)) {
    return { ...point, longitude: lng, latitude: lat }
  }

  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { ...point, longitude: lng + dLng, latitude: lat + dLat }
}
