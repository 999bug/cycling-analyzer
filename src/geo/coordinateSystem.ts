/**
 * 坐标系转换（WGS-84 / GCJ-02 / BD-09）。
 *
 * 三种坐标系的关系（轨迹纠偏功能的基础）：
 * - WGS-84：GPS 真值，国际标准。Garmin / Strava / Wahoo 导出与本站存储口径。
 * - GCJ-02（火星坐标）：WGS-84 叠加非线性偏移的结果。高德、腾讯及
 *   国内运动 App（行者 / Keep / 咕咚等）导出的 GPX 多为此坐标系。
 * - BD-09：在 GCJ-02 之上再叠加一次偏移。百度系专用。
 *
 * 设计约定：
 * - 全部为纯函数，输入输出均为十进制度，保留入参对象的其余字段（如 timestamp）；
 * - 全部可逆：往返转换误差 < 1cm（迭代反解，见单测断言）；
 * - 中国境外不加偏移，原样返回（加密算法本身如此，反解路径同样遵守）；
 * - **落库数据永不因纠偏改写**——纠偏只改坐标系标记，转换发生在消费层。
 *   因此任意次数的来回切换都是幂等的，不会累积误差（同一坐标系转换即恒等函数）。
 */

/** 支持的轨迹坐标系 */
export type CoordinateSystem = 'wgs84' | 'gcj02' | 'bd09'

/** 具备经纬度的最小点结构（转换保留其余字段，故用泛型） */
export interface GeoPoint {
  /** 经度（十进制度） */
  longitude: number

  /** 纬度（十进制度） */
  latitude: number
}

/** 克氏椭球长半轴（米） */
const GCJ_A = 6378245.0

/** 克氏椭球偏心率平方 */
const GCJ_EE = 0.006693421622965943

/** 中国境内判定经度下限（度） */
const CHINA_LNG_MIN = 72.004

/** 中国境内判定经度上限（度） */
const CHINA_LNG_MAX = 137.8347

/** 中国境内判定纬度下限（度） */
const CHINA_LAT_MIN = 0.8293

/** 中国境内判定纬度上限（度） */
const CHINA_LAT_MAX = 55.8271

/** GCJ-02 加密算法中的经度基准平移量（度） */
const GCJ_LNG_BASE = 105.0

/** GCJ-02 加密算法中的纬度基准平移量（度） */
const GCJ_LAT_BASE = 35.0

/** GCJ-02 → WGS-84 迭代反解次数（3 次已收敛到厘米级） */
const INVERSE_ITERATIONS = 3

/** BD-09 换算用的 π 系数：π × 3000 / 180 */
const BD_X_PI = (Math.PI * 3000.0) / 180.0

/** BD-09 ↔ GCJ-02 的经度平移量（度） */
const BD_LNG_OFFSET = 0.0065

/** BD-09 ↔ GCJ-02 的纬度平移量（度） */
const BD_LAT_OFFSET = 0.006

/** BD-09 极坐标扰动的经向振幅系数 */
const BD_RADIUS_NOISE = 0.00002

/** BD-09 极坐标扰动的角度振幅系数 */
const BD_ANGLE_NOISE = 0.000003

/** 纬度每度对应的米数（WGS-84 平均值，米→度换算用） */
const METERS_PER_DEGREE_LAT = 111320

/**
 * 判断坐标是否在中国境外（境外不加偏移，原样返回）。
 *
 * @param lng 经度（十进制度）
 * @param lat 纬度（十进制度）
 * @returns 是否在中国境外
 */
export function isOutOfChina(lng: number, lat: number): boolean {
  return lng < CHINA_LNG_MIN || lng > CHINA_LNG_MAX || lat < CHINA_LAT_MIN || lat > CHINA_LAT_MAX
}

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
 * WGS-84 → GCJ-02（火星坐标）。
 *
 * @param point WGS-84 坐标（十进制度）
 * @returns GCJ-02 坐标（其余字段原样保留）
 */
export function wgs84ToGcj02<T extends GeoPoint>(point: T): T {
  const { longitude: lng, latitude: lat } = point

  if (isOutOfChina(lng, lat)) {
    return { ...point }
  }

  let dLat = transformLat(lng - GCJ_LNG_BASE, lat - GCJ_LAT_BASE)
  let dLng = transformLng(lng - GCJ_LNG_BASE, lat - GCJ_LAT_BASE)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { ...point, longitude: lng + dLng, latitude: lat + dLat }
}

/**
 * GCJ-02 → WGS-84（迭代反解）。
 *
 * 正变换无解析逆，用不动点迭代：以 GCJ 点作为 WGS 初值，反复用
 * 「正变换结果与目标的残差」修正当前估计值。3 次迭代残差已降到厘米级。
 *
 * @param point GCJ-02 坐标（十进制度）
 * @returns WGS-84 坐标（其余字段原样保留）
 */
export function gcj02ToWgs84<T extends GeoPoint>(point: T): T {
  const { longitude: targetLng, latitude: targetLat } = point

  if (isOutOfChina(targetLng, targetLat)) {
    return { ...point }
  }

  let lng = targetLng
  let lat = targetLat
  for (let i = 0; i < INVERSE_ITERATIONS; i += 1) {
    const estimate = wgs84ToGcj02({ longitude: lng, latitude: lat })
    lng += targetLng - estimate.longitude
    lat += targetLat - estimate.latitude
  }
  return { ...point, longitude: lng, latitude: lat }
}

/**
 * GCJ-02 → BD-09（百度坐标）。
 *
 * @param point GCJ-02 坐标（十进制度）
 * @returns BD-09 坐标（其余字段原样保留）
 */
export function gcj02ToBd09<T extends GeoPoint>(point: T): T {
  const { longitude: lng, latitude: lat } = point
  const z = Math.sqrt(lng * lng + lat * lat) + BD_RADIUS_NOISE * Math.sin(lat * BD_X_PI)
  const theta = Math.atan2(lat, lng) + BD_ANGLE_NOISE * Math.cos(lng * BD_X_PI)
  return {
    ...point,
    longitude: z * Math.cos(theta) + BD_LNG_OFFSET,
    latitude: z * Math.sin(theta) + BD_LAT_OFFSET,
  }
}

/**
 * BD-09 → GCJ-02（百度坐标反解）。
 *
 * @param point BD-09 坐标（十进制度）
 * @returns GCJ-02 坐标（其余字段原样保留）
 */
export function bd09ToGcj02<T extends GeoPoint>(point: T): T {
  const { longitude: lng, latitude: lat } = point
  const x = lng - BD_LNG_OFFSET
  const y = lat - BD_LAT_OFFSET
  const z = Math.sqrt(x * x + y * y) - BD_RADIUS_NOISE * Math.sin(y * BD_X_PI)
  const theta = Math.atan2(y, x) - BD_ANGLE_NOISE * Math.cos(x * BD_X_PI)
  return { ...point, longitude: z * Math.cos(theta), latitude: z * Math.sin(theta) }
}

/**
 * WGS-84 → BD-09（经 GCJ-02 中转）。
 *
 * @param point WGS-84 坐标（十进制度）
 * @returns BD-09 坐标（其余字段原样保留）
 */
export function wgs84ToBd09<T extends GeoPoint>(point: T): T {
  return gcj02ToBd09(wgs84ToGcj02(point))
}

/**
 * BD-09 → WGS-84（经 GCJ-02 中转）。
 *
 * @param point BD-09 坐标（十进制度）
 * @returns WGS-84 坐标（其余字段原样保留）
 */
export function bd09ToWgs84<T extends GeoPoint>(point: T): T {
  return gcj02ToWgs84(bd09ToGcj02(point))
}

/**
 * 任意坐标系 → WGS-84（本站内部统一口径）。
 *
 * @param point 源坐标（十进制度）
 * @param from 源坐标系
 * @returns WGS-84 坐标（其余字段原样保留）
 */
export function toWgs84<T extends GeoPoint>(point: T, from: CoordinateSystem): T {
  if (from === 'gcj02') {
    return gcj02ToWgs84(point)
  }
  if (from === 'bd09') {
    return bd09ToWgs84(point)
  }
  return { ...point }
}

/**
 * WGS-84 → 任意坐标系（展示/导出时按目标底图还原）。
 *
 * @param point WGS-84 坐标（十进制度）
 * @param to 目标坐标系
 * @returns 目标坐标系下的坐标（其余字段原样保留）
 */
export function fromWgs84<T extends GeoPoint>(point: T, to: CoordinateSystem): T {
  if (to === 'gcj02') {
    return wgs84ToGcj02(point)
  }
  if (to === 'bd09') {
    return wgs84ToBd09(point)
  }
  return { ...point }
}

/**
 * 任意坐标系之间的直接转换（内部统一走 WGS-84 中转）。
 *
 * 同一坐标系时原样返回，保证幂等——重复施加同一转换不会累积误差，
 * 这是「来回切换来源不会把轨迹越转越歪」的数学保证。
 *
 * @param point 源坐标（十进制度）
 * @param from 源坐标系
 * @param to 目标坐标系
 * @returns 目标坐标系下的坐标（其余字段原样保留）
 */
export function convertPoint<T extends GeoPoint>(
  point: T,
  from: CoordinateSystem,
  to: CoordinateSystem,
): T {
  // 同一坐标系直接短路：既省掉两次中转开销，也杜绝中转带来的浮点残差，
  // 使幂等成为数学上的严格保证（而非「近似相等」）
  if (from === to) {
    return { ...point }
  }
  return fromWgs84(toWgs84(point, from), to)
}

/**
 * 按米为单位平移坐标（轨迹手动微调用）。
 *
 * 约定在**归一化到 WGS-84 之后**施加，故与坐标系设定互不干扰：
 * 用户切换来源不会丢失微调，微调也不污染坐标系语义。
 * 经度方向按当前纬度收缩（高纬度 1 度经度更短）。
 *
 * @param point 输入坐标（应为 WGS-84，十进制度）
 * @param northMeters 北向平移（米，正 = 向北）
 * @param eastMeters 东向平移（米，正 = 向东）
 * @returns 平移后的坐标（其余字段原样保留）
 */
export function applyOffsetMeters<T extends GeoPoint>(
  point: T,
  northMeters: number,
  eastMeters: number,
): T {
  if (northMeters === 0 && eastMeters === 0) {
    return { ...point }
  }
  const dLat = northMeters / METERS_PER_DEGREE_LAT
  const dLng = eastMeters / (METERS_PER_DEGREE_LAT * Math.cos((point.latitude / 180) * Math.PI))
  return { ...point, longitude: point.longitude + dLng, latitude: point.latitude + dLat }
}
