/**
 * 多指标曲线数据转换（records → 对齐序列 + 归一化渲染数据）。
 *
 * 「数据曲线」卡片（规格 §17 演进：单指标图合并为开关式多指标卡）：
 * - 各指标共用同一 x 基准（时间/距离），逐点一一对应，不会各自过滤导致错位
 * - 指标缺失的点保留 undefined（区别于 0，规格 §25），由图表层断线处理
 * - 量纲差异大（米/bpm/W/…），渲染前把各指标归一化到 [0,1] 叠加，
 *   真实数值经渲染点的原始值字段供 Tooltip 展示
 */
import type { ActivityRecord } from '@/types/activity'
import type { MetricField, XAxisMode } from '@/charts/series'

/** 归一化渲染键前缀（`norm_` + 指标字段名） */
const NORM_KEY_PREFIX = 'norm_'

/**
 * 多指标元数据：展示顺序、chip 名称、线条颜色与数值单位。
 * 颜色沿用原各单指标图表（速度蓝/心率红/踏频紫/功率橙/温度橙红/海拔绿）。
 */
export interface MultiMetricMetaEntry {
  /** 指标字段 */
  field: MetricField

  /** 展示名称（chip / Tooltip 行名） */
  label: string

  /** 线条与 chip 色点颜色 */
  color: string

  /** 数值单位（Tooltip 展示；km/h 触发 m/s 换算） */
  unit: string
}

/** 多指标展示元数据（顺序即 chip 顺序：海拔默认居首） */
export const MULTI_METRIC_META: readonly MultiMetricMetaEntry[] = [
  { field: 'altitude', label: '海拔', color: '#34c759', unit: 'm' },
  { field: 'speed', label: '速度', color: '#4f8cff', unit: 'km/h' },
  { field: 'heartRate', label: '心率', color: '#ff6482', unit: 'bpm' },
  { field: 'cadence', label: '踏频', color: '#a78bfa', unit: 'rpm' },
  { field: 'power', label: '功率', color: '#ff9f0a', unit: 'W' },
  { field: 'temperature', label: '温度', color: '#fb923c', unit: '°C' },
]

/** 多指标序列点：各指标原始值共用同一 x 基准 */
export interface MultiMetricPoint {
  /** X 轴取值（time 模式：距起点秒数；distance 模式：距起点累计距离米） */
  x: number

  /** 原始时间戳（Unix 秒，共享时间轴联动用） */
  timestamp: number

  /** 各指标原始值（缺失为 undefined） */
  values: Partial<Record<MetricField, number>>
}

/** 指标值域（归一化用） */
export interface MetricRange {
  /** 有效值最小值 */
  min: number

  /** 有效值最大值 */
  max: number
}

/**
 * 探测逐点记录中存在的指标（任一记录含该字段即算有数据）。
 *
 * @param records 逐点记录
 * @returns 有数据的指标字段（按 MULTI_METRIC_META 顺序）
 */
export function availableMetrics(records: readonly ActivityRecord[]): MetricField[] {
  return MULTI_METRIC_META.filter((meta) =>
    records.some((record) => record[meta.field] !== undefined),
  ).map((meta) => meta.field)
}

/**
 * 构建多指标对齐序列：所有启用指标共用同一 x 基准（首条任一指标有效的记录），
 * 单指标缺失的点保留 undefined（规格 §25 不伪造 0 值），由图表层断线。
 *
 * @param records 逐点记录
 * @param metrics 启用指标
 * @param mode X 轴模式
 * @returns 按时间升序的对齐数据点（所有启用指标均无有效数据时为空数组）
 */
export function buildMultiMetricSeries(
  records: readonly ActivityRecord[],
  metrics: readonly MetricField[],
  mode: XAxisMode,
): MultiMetricPoint[] {
  if (metrics.length === 0) {
    return []
  }
  const metricSet = new Set(metrics)
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp)

  // 至少一个启用指标有效，且 distance 模式下需有累计距离（保证 x 有定义）
  const valid = sorted.filter(
    (record) =>
      metrics.some((metric) => record[metric] !== undefined) &&
      (mode !== 'distance' || record.distance !== undefined),
  )

  if (valid.length === 0) {
    return []
  }

  const baseTime = valid[0].timestamp
  const baseDistance = mode === 'distance' ? valid[0].distance! : 0
  return valid.map((record) => {
    const values: Partial<Record<MetricField, number>> = {}
    for (const metric of metricSet) {
      values[metric] = record[metric]
    }
    return {
      x: mode === 'time' ? record.timestamp - baseTime : record.distance! - baseDistance,
      timestamp: record.timestamp,
      values,
    }
  })
}

/**
 * 计算各指标有效值域（归一化分母）。
 *
 * @param points 多指标对齐序列
 * @param metrics 启用指标
 * @returns 指标 → 值域；该指标无任何有效值时不产出条目
 */
export function metricRanges(
  points: readonly MultiMetricPoint[],
  metrics: readonly MetricField[],
): Partial<Record<MetricField, MetricRange>> {
  const ranges: Partial<Record<MetricField, MetricRange>> = {}
  for (const metric of metrics) {
    let min = Infinity
    let max = -Infinity
    for (const point of points) {
      const value = point.values[metric]
      if (value === undefined) {
        continue
      }
      if (value < min) {
        min = value
      }
      if (value > max) {
        max = value
      }
    }
    if (min !== Infinity) {
      ranges[metric] = { min, max }
    }
  }
  return ranges
}

/**
 * 归一化渲染数据点：原始值（`指标字段` 键，Tooltip 展示）+
 * 归一化显示值（`norm_` 前缀键，画线用；缺失为 undefined 断线）。
 *
 * 键均为扁平字符串，规避 recharts 函数式 dataKey 的类型限制；
 * 单点/恒值指标（min === max）归一化为 0.5 居中。
 */
export type MultiMetricRenderPoint = Record<string, number | undefined>

/**
 * 构建归一化渲染数据（画线数据 + Tooltip 原始值同点携带）。
 *
 * @param points 多指标对齐序列
 * @param ranges 各指标值域
 * @param metrics 启用指标
 * @returns 渲染数据点数组（与序列一一对应）
 */
export function buildMultiMetricRenderData(
  points: readonly MultiMetricPoint[],
  ranges: Partial<Record<MetricField, MetricRange>>,
  metrics: readonly MetricField[],
): MultiMetricRenderPoint[] {
  return points.map((point) => {
    const entry: MultiMetricRenderPoint = { x: point.x, timestamp: point.timestamp }
    for (const metric of metrics) {
      const value = point.values[metric]
      entry[metric] = value
      const range = ranges[metric]
      if (value === undefined || range === undefined) {
        entry[NORM_KEY_PREFIX + metric] = undefined
        continue
      }
      const span = range.max - range.min
      entry[NORM_KEY_PREFIX + metric] = span === 0 ? 0.5 : (value - range.min) / span
    }
    return entry
  })
}

/**
 * 指标归一化渲染键（Line 的 dataKey）。
 *
 * @param metric 指标字段
 * @returns 如 'norm_altitude'
 */
export function normDataKey(metric: MetricField): string {
  return NORM_KEY_PREFIX + metric
}
