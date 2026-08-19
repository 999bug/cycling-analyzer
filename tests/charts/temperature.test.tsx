/**
 * 温度图测试：series 转换（缺失过滤）+ 组件渲染空态。
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import TemperatureChart from '@/charts/TemperatureChart'
import { buildSeries } from '@/charts/series'

/**
 * 构造逐点记录（未提供的可选字段为 undefined，模拟缺失）。
 */
function makeRecord(overrides: Partial<ActivityRecord> & { timestamp: number }): ActivityRecord {
  return { ...overrides }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildSeries（温度）', () => {
  it('缺失温度的记录被过滤，温度值原样保留', () => {
    const records = [
      makeRecord({ timestamp: 0, temperature: 22 }),
      makeRecord({ timestamp: 10 }), // 温度缺失
      makeRecord({ timestamp: 20, temperature: 25.5 }),
    ]
    const series = buildSeries(records, 'temperature', 'time')
    expect(series).toHaveLength(2)
    expect(series.map((point) => point.y)).toEqual([22, 25.5])
  })

  it('distance 模式以累计距离为 x 轴', () => {
    const records = [
      makeRecord({ timestamp: 0, temperature: 20, distance: 0 }),
      makeRecord({ timestamp: 60, temperature: 22, distance: 500 }),
    ]
    const series = buildSeries(records, 'temperature', 'distance')
    expect(series.map((point) => point.x)).toEqual([0, 500])
    expect(series.map((point) => point.y)).toEqual([20, 22])
  })

  it('无温度数据时返回空数组', () => {
    expect(buildSeries([makeRecord({ timestamp: 1 })], 'temperature', 'time')).toEqual([])
  })
})

describe('TemperatureChart', () => {
  it('无温度数据时显示空态提示，不渲染图表', () => {
    render(<TemperatureChart records={[makeRecord({ timestamp: 1 })]} />)

    expect(screen.getByText('该活动没有温度数据')).toBeInTheDocument()
  })

  it('有数据时渲染标题与时间/距离切换按钮', () => {
    // jsdom 中 getBoundingClientRect 恒为 0，mock 容器尺寸让 Recharts 正常渲染
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 220,
    } as DOMRect)
    render(<TemperatureChart records={[makeRecord({ timestamp: 0, temperature: 22, distance: 0 })]} />)

    expect(screen.getByText('温度')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '距离' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '时间' })).toBeInTheDocument()
    expect(screen.queryByText('该活动没有温度数据')).not.toBeInTheDocument()
  })
})
