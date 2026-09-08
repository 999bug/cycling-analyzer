/**
 * 轨迹展示投影：原始坐标 → 归一化 → 手动微调 → 目标坐标系。
 *
 * 全站**唯一**的几何消费出口：地图、热力图、路线图、赛段匹配、GPX 导出
 * 都必须走这里。历史上 ActivityMap / SegmentMiniMap / HeatmapPage 三处
 * 各写一份 `isGcjSource ? wgs84ToGcj02 : 原样` 判断，正是本次纠偏要收敛的重复。
 *
 * 两条硬约定：
 * 1. 源数据（records）永存导入时的**原始坐标**，投影每次现算、不落库；
 * 2. 因此「改来源」= 改一个标记，任意次数来回切换都严格还原、零误差累积。
 */

import {
  applyOffsetMeters,
  fromWgs84,
  toWgs84,
  type CoordinateSystem,
  type GeoPoint,
} from './coordinateSystem'

/** 投影选项 */
export interface ProjectOptions {
  /** 源坐标所属坐标系（缺省 wgs84，即未标记的历史数据按国际标准处理） */
  from?: CoordinateSystem

  /** 目标坐标系（底图基准或导出目标） */
  to: CoordinateSystem

  /** 北向微调（米，缺省 0） */
  northMeters?: number

  /** 东向微调（米，缺省 0） */
  eastMeters?: number
}

/**
 * 投影单个点到目标坐标系。
 *
 * @param point 源坐标（原始存储值，十进制度）
 * @param options 投影选项
 * @returns 目标坐标系下的坐标（其余字段原样保留）
 */
export function projectPoint<T extends GeoPoint>(point: T, options: ProjectOptions): T {
  const normalized = toWgs84(point, options.from ?? 'wgs84')
  const shifted = applyOffsetMeters(normalized, options.northMeters ?? 0, options.eastMeters ?? 0)
  return fromWgs84(shifted, options.to)
}

/**
 * 批量投影（轨迹点数组）。
 *
 * @param points 源坐标数组
 * @param options 投影选项
 * @returns 投影后的新数组（不修改入参）
 */
export function projectPoints<T extends GeoPoint>(
  points: readonly T[],
  options: ProjectOptions,
): T[] {
  return points.map((point) => projectPoint(point, options))
}
