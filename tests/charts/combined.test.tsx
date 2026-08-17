/**
 * 组合图测试（规格 §17 后续增加）：
 * buildCombinedSeries 双序列对齐（统一基准，逐点对应）+ 缺失值降级 + 组件渲染空态。
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import CombinedChart from '@/charts/CombinedChart'
import { buildCombinedSeries } from '@/charts/series'

/**
 * 构造逐点记录（未提供的可选字段为 undefined，模拟缺失）。
 */
function makeRecord(overrides: Partial<ActivityRecord> & { timestamp: number }): ActivityRecord {
  return { ...overrides }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildCombinedSeries', () => {
  it('time 模式：双序列逐点对齐，单序列缺失点保留为 undefined', () => {
    const records = [
      makeRecord({ timestamp: 0, speed: 5 }),
      makeRecord({ timestamp: 10, speed: 6, heartRate: 150 }),
      makeRecord({ timestamp: 20, speed: 7, heartRate: 160 }),
    ]
    const series = buildCombinedSeries(records, 'speed', 'time')
    expect(series).toEqual([
      { x: 0, primary: 5, heartRate: undefined, timestamp: 0 },
      { x: 10, primary: 6, heartRate: 150, timestamp: 10 },
      { x: 20, primary: 7, heartRate: 160, timestamp: 20 },
    ])
  })

  it('首条记录心率缺失时两条线仍共享同一 x 基准（不各自归零）', () => {
    // 独立构建会以各自首条有效记录为基准，导致心率线相对速度线整体左移
    const records = [
      makeRecord({ timestamp: 0, speed: 5 }), // 心率缺失
      makeRecord({ timestamp: 10, speed: 6, heartRate: 150 }),
    ]
    const series = buildCombinedSeries(records, 'speed', 'time')
    // 心率线的 x 应为 10（与速度线对齐），而非相对自身首点的 0
    expect(series.map((point) => point.x)).toEqual([0, 10])
    expect(series[1].heartRate).toBe(150)
  })

  it('distance 模式以累计距离为 x 轴', () => {
    const records = [
      makeRecord({ timestamp: 0, power: 200, heartRate: 140, distance: 0 }),
      makeRecord({ timestamp: 60, power: 220, distance: 400 }), // 心率缺失
      makeRecord({ timestamp: 120, power: 240, heartRate: 155, distance: 900 }),
    ]
    const series = buildCombinedSeries(records, 'power', 'distance')
    expect(series.map((point) => point.x)).toEqual([0, 400, 900])
    expect(series.map((point) => point.primary)).toEqual([200, 220, 240])
    expect(series.map((point) => point.heartRate)).toEqual([140, undefined, 155])
  })

  it('distance 模式下累计距离缺失的记录被过滤', () => {
    const records = [
      makeRecord({ timestamp: 0, speed: 5, distance: 0 }),
      makeRecord({ timestamp: 10, speed: 6 }), // distance 缺失
      makeRecord({ timestamp: 20, speed: 7, heartRate: 160, distance: 500 }),
    ]
    const series = buildCombinedSeries(records, 'speed', 'distance')
    expect(series.map((point) => point.x)).toEqual([0, 500])
    expect(series.map((point) => point.primary)).toEqual([5, 7])
  })

  it('双指标均无有效数据时返回空数组', () => {
    expect(buildCombinedSeries([], 'speed', 'time')).toEqual([])
    const records = [makeRecord({ timestamp: 1 })] // 速度与心率均缺失
    expect(buildCombinedSeries(records, 'speed', 'time')).toEqual([])
  })
})

describe('CombinedChart', () => {
  it('无数据时显示空态提示，不渲染图表', () => {
    render(<CombinedChart mode="speedHeartRate" records={[makeRecord({ timestamp: 1 })]} />)

    expect(screen.getByText('该活动没有速度和心率数据')).toBeInTheDocument()
  })

  it('仅缺失心率时仍渲染（降级为单序列），不显示空态', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 220,
    } as DOMRect)
    render(
      <CombinedChart
        mode="speedHeartRate"
        records={[makeRecord({ timestamp: 0, speed: 5, distance: 0 })]}
      />,
    )

    expect(screen.getByText('速度 + 心率')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '时间' })).toBeInTheDocument()
    expect(screen.queryByText('该活动没有速度和心率数据')).not.toBeInTheDocument()
  })

  it('功率+心率模式无功率数据时降级为单序列', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 220,
    } as DOMRect)
    render(
      <CombinedChart
        mode="powerHeartRate"
        records={[makeRecord({ timestamp: 0, heartRate: 150, distance: 0 })]}
      />,
    )

    expect(screen.getByText('功率 + 心率')).toBeInTheDocument()
    expect(screen.queryByText('该活动没有功率和心率数据')).not.toBeInTheDocument()
  })
})
