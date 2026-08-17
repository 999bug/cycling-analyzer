/**
 * 图表数据转换（records → series 纯函数，规格 §17）。
 *
 * 与 UI 解耦以便单测：图表组件只消费本模块产出的 series。
 * 缺失字段（undefined）的记录被过滤，不会产生 0 值假数据。
 */
import type { ActivityRecord } from '@/types/activity'

/** X 轴模式：time 为距起点秒数，distance 为累计距离（米） */
export type XAxisMode = 'time' | 'distance'

/** 可绘制的指标字段 */
export type MetricField = 'speed' | 'heartRate' | 'altitude' | 'power' | 'cadence'

/** 图表数据点 */
export interface ChartSeriesPoint {
  /** X 轴取值（time 模式：秒；distance 模式：米） */
  x: number

  /** Y 轴取值（原始单位：m/s、bpm、m、W、rpm） */
  y: number

  /** 原始时间戳（Unix 秒，Tooltip 展示用） */
  timestamp: number
}

/**
 * 从逐点记录构建图表序列。
 * 过滤该指标缺失的记录；distance 模式下同时过滤累计距离缺失的记录。
 *
 * @param records 逐点记录
 * @param metric 指标字段
 * @param mode X 轴模式
 * @returns 按时间升序的图表数据点（无有效数据时为空数组）
 */
export function buildSeries(
  records: readonly ActivityRecord[],
  metric: MetricField,
  mode: XAxisMode,
): ChartSeriesPoint[] {
  const valid = records
    .filter((record) => record[metric] !== undefined)
    .filter((record) => mode !== 'distance' || record.distance !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp)

  if (valid.length === 0) {
    return []
  }

  const baseTime = valid[0].timestamp
  const baseDistance = mode === 'distance' ? valid[0].distance! : 0
  return valid.map((record) => ({
    x: mode === 'time' ? record.timestamp - baseTime : record.distance! - baseDistance,
    y: record[metric]!,
    timestamp: record.timestamp,
  }))
}
