/**
 * 踏频图测试（规格 §17 后续增加）：series 转换（缺失过滤、时间/距离轴）+ 组件渲染空态。
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import CadenceChart from '@/charts/CadenceChart'
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

describe('buildSeries（踏频）', () => {
  it('缺失踏频的记录被过滤，rpm 值原样保留', () => {
    const records = [
      makeRecord({ timestamp: 0, cadence: 90 }),
      makeRecord({ timestamp: 10 }), // 踏频缺失
      makeRecord({ timestamp: 20, cadence: 95 }),
    ]
    const series = buildSeries(records, 'cadence', 'time')
    expect(series).toHaveLength(2)
    expect(series.map((point) => point.y)).toEqual([90, 95])
  })

  it('distance 模式以累计距离为 x 轴', () => {
    const records = [
      makeRecord({ timestamp: 0, cadence: 90, distance: 0 }),
      makeRecord({ timestamp: 60, cadence: 100, distance: 500 }),
      makeRecord({ timestamp: 120, cadence: 95, distance: 1200 }),
    ]
    const series = buildSeries(records, 'cadence', 'distance')
    expect(series.map((point) => point.x)).toEqual([0, 500, 1200])
    expect(series.map((point) => point.y)).toEqual([90, 100, 95])
  })

  it('无踏频数据时返回空数组', () => {
    expect(buildSeries([makeRecord({ timestamp: 1 })], 'cadence', 'time')).toEqual([])
  })
})

describe('CadenceChart', () => {
  it('无踏频数据时显示空态提示，不渲染图表', () => {
    render(<CadenceChart records={[makeRecord({ timestamp: 1 })]} />)

    expect(screen.getByText('该活动没有踏频数据')).toBeInTheDocument()
  })

  it('有数据时渲染标题与时间/距离切换按钮', () => {
    // jsdom 中 getBoundingClientRect 恒为 0，mock 容器尺寸让 Recharts 正常渲染
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 220,
    } as DOMRect)
    render(<CadenceChart records={[makeRecord({ timestamp: 0, cadence: 90, distance: 0 })]} />)

    expect(screen.getByText('踏频')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '距离' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '时间' })).toBeInTheDocument()
    expect(screen.queryByText('该活动没有踏频数据')).not.toBeInTheDocument()
  })
})
