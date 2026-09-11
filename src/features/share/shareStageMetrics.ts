/**
 * 真实界面分享卡：指标口径（分享素材 v2）。
 *
 * 朋友圈单图与小红书四页共用——单位白名单、缺失值不拼单位、封面钩子指标的优先级
 * 只在这里写一遍，避免两处样式慢慢跑偏。
 */

import type { ShareData } from '@/features/share/shareData'

/** 可拼到数值后的计量单位（时长 h:mm 这类不算，避免「4:12 h:mm」这种读法） */
const VALUE_UNITS = new Set(['km', 'mi', 'm', 'km/h', 'mph', 'bpm', 'W', 'rpm'])

/**
 * 拆指标标签「距离 (km)」→ 名称 + 单位。
 *
 * @param label 分享数据里的指标标签
 */
export function splitMetricLabel(label: string): { name: string; unit?: string } {
  const match = /^(.*?)\s*\((.+)\)$/.exec(label)
  if (match === null) {
    return { name: label }
  }
  const unit = match[2]
  return { name: match[1], unit: VALUE_UNITS.has(unit) ? unit : undefined }
}

/**
 * 取值时是否要拼单位：缺失值 '—' 一律不拼（避免「— km」这种看起来像真数据的读法）。
 *
 * @param label 指标标签（含括号单位）
 * @param value 指标值
 */
export function metricUnitSuffix(label: string, value: string): string | undefined {
  const { unit } = splitMetricLabel(label)
  return unit !== undefined && value !== '—' ? unit : undefined
}

/** 钩子指标（封面大数字） */
export interface StageHookMetric {
  /** 在 metrics 中的下标（次要指标要把它排除掉） */
  index: number

  /** 指标名（已去掉括号单位） */
  label: string

  /** 数值（可能为 '—'） */
  value: string

  /** 拼在数值后的单位（可能为空串） */
  unit: string
}

/**
 * 选封面钩子指标：距离 > 爬升 > 时长（全缺时回退第一项并如实显示 '—'，绝不编数字）。
 *
 * @param metrics 分享数据的指标列表
 */
export function pickHookMetric(metrics: ShareData['metrics']): StageHookMetric {
  // 下标与单位同源：0 距离 / 2 爬升 / 1 时长（shareData.buildShareData 的固定顺序）
  const candidates: Array<{ index: number; unit: string }> = [
    { index: 0, unit: 'km' },
    { index: 2, unit: 'm' },
    { index: 1, unit: '' },
  ]
  for (const candidate of candidates) {
    const metric = metrics[candidate.index]
    if (metric !== undefined && metric.value !== '—') {
      return {
        index: candidate.index,
        label: splitMetricLabel(metric.label).name,
        value: metric.value,
        unit: candidate.unit,
      }
    }
  }
  const fallback = metrics[0]
  return {
    index: 0,
    label: splitMetricLabel(fallback.label).name,
    value: fallback.value,
    unit: '',
  }
}
