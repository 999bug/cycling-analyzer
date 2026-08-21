/**
 * 表现趋势分析测试（近 4 周 vs 前 4 周 + 最强周/训练节奏）。
 */
import { describe, expect, it } from 'vitest'
import {
  analyzePerformanceTrend,
  formatPercentDelta,
} from '@/features/analysis/performanceTrend'
import type { WeekSummary } from '@/features/analysis/weeklyStats'

/** 周起点键（从基准周 +i 周） */
function weekKey(i: number): string {
  const base = new Date(2026, 4, 4) // 2026-05-04 周一
  base.setDate(base.getDate() + i * 7)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
}

/**
 * 构造 12 周序列：可指定每项覆盖。
 *
 * @param overrides 每项覆盖（index → 覆盖）
 */
function makeSeries(
  overrides: Array<Partial<WeekSummary>> = [],
): WeekSummary[] {
  return Array.from({ length: 12 }, (_, index) => ({
    weekStart: weekKey(index),
    rides: index % 3 === 2 ? 0 : 2,
    distance: 10000,
    duration: 3600,
    elevationGain: 200,
    efficiencyFactor: index % 2 === 0 ? 1.0 : 0.9,
    ...overrides[index],
  }))
}

describe('analyzePerformanceTrend', () => {
  it('近 4 周 vs 前 4 周：距离与效率因子均值与变化', () => {
    const series = makeSeries()
    // 近 4 周（8-11）覆盖：距离 15000、EF 1.2；前 4 周（4-7）默认 10000/混合 EF
    for (let i = 8; i < 12; i++) {
      series[i] = { ...series[i], distance: 15000, efficiencyFactor: 1.2 }
    }
    const insights = analyzePerformanceTrend(series)

    expect(insights.recentDistanceAvg).toBeCloseTo(15000, 6)
    expect(insights.previousDistanceAvg).toBeCloseTo(10000, 6)
    expect(insights.distancePercentChange).toBeCloseTo(50, 6)
    // 前 4 周 EF 均值 = (1.0+0.9+1.0+0.9)/4 = 0.95；近 4 周 = 1.2
    expect(insights.previousEfAvg).toBeCloseTo(0.95, 6)
    expect(insights.recentEfAvg).toBeCloseTo(1.2, 6)
    expect(insights.efPercentChange).toBeCloseTo((1.2 - 0.95) / 0.95 * 100, 6)
    // 最强周 = 最近 15000 的一周；效率最高周 = EF 1.2 的一周
    expect(insights.bestDistanceWeek?.distance).toBe(15000)
    expect(insights.bestEfWeek?.efficiencyFactor).toBe(1.2)
    // 12 周中 index%3===2 为 rest 周 → active 8
    expect(insights.activeWeeks).toBe(8)
    expect(insights.idleWeeks).toBe(4)
  })

  it('前 4 周距离为 0 时距离变化为 undefined（不伪造）', () => {
    const series = makeSeries()
    for (let i = 0; i < 8; i++) {
      series[i] = { ...series[i], distance: 0, rides: 0 }
    }
    for (let i = 8; i < 12; i++) {
      series[i] = { ...series[i], distance: 5000 }
    }
    const insights = analyzePerformanceTrend(series)

    expect(insights.recentDistanceAvg).toBeCloseTo(5000, 6)
    expect(insights.previousDistanceAvg).toBeCloseTo(0, 6)
    expect(insights.distancePercentChange).toBeUndefined()
  })

  it('无效率因子数据时 EF 分析为 undefined', () => {
    const series = makeSeries(
      Array.from({ length: 12 }).map(() => ({ efficiencyFactor: undefined })),
    )
    const insights = analyzePerformanceTrend(series)

    expect(insights.recentEfAvg).toBeUndefined()
    expect(insights.previousEfAvg).toBeUndefined()
    expect(insights.efPercentChange).toBeUndefined()
    expect(insights.bestEfWeek).toBeUndefined()
  })

  it('TSS 仅在配置 FTP（序列含 tss）时输出', () => {
    const series = makeSeries()
    for (let i = 8; i < 12; i++) {
      series[i] = { ...series[i], tss: 200 }
    }
    for (let i = 4; i < 8; i++) {
      series[i] = { ...series[i], tss: 100 }
    }
    const insights = analyzePerformanceTrend(series)

    expect(insights.recentTssAvg).toBeCloseTo(200, 6)
    expect(insights.previousTssAvg).toBeCloseTo(100, 6)
    expect(insights.tssPercentChange).toBeCloseTo(100, 6)
  })

  it('空序列：各项为 0/undefined，不崩溃', () => {
    const insights = analyzePerformanceTrend([])

    expect(insights.recentDistanceAvg).toBe(0)
    expect(insights.previousDistanceAvg).toBe(0)
    expect(insights.distancePercentChange).toBeUndefined()
    expect(insights.recentEfAvg).toBeUndefined()
    expect(insights.activeWeeks).toBe(0)
    expect(insights.idleWeeks).toBe(0)
    expect(insights.bestDistanceWeek).toBeUndefined()
    expect(insights.bestEfWeek).toBeUndefined()
  })
})

describe('formatPercentDelta', () => {
  it('格式化百分比变化（↑/↓ + 一位小数）', () => {
    expect(formatPercentDelta(12.34)).toBe('↑12.3%')
    expect(formatPercentDelta(-5)).toBe('↓5.0%')
    expect(formatPercentDelta(undefined)).toBeUndefined()
  })
})