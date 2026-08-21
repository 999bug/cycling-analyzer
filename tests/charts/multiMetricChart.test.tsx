/**
 * 多指标曲线卡测试：纯函数（可用指标探测/对齐序列/归一化渲染数据）+ 组件渲染
 * （默认海拔开关、chip 切换、全关引导、悬停 Tooltip 展示已开指标、共享时间轴上报）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import MultiMetricChart from '@/charts/MultiMetricChart'
import {
  availableMetrics,
  buildMultiMetricRenderData,
  buildMultiMetricSeries,
  metricRanges,
  MULTI_METRIC_META,
  normDataKey,
} from '@/charts/multiMetricSeries'

/**
 * 构造逐点记录（未提供的可选字段为 undefined，模拟缺失）。
 */
function makeRecord(overrides: Partial<ActivityRecord> & { timestamp: number }): ActivityRecord {
  return { ...overrides }
}

/** 五点样本：海拔 100→180、速度 8→10 m/s、心率 120→160，无踏频/功率/温度 */
function makeRecords(): ActivityRecord[] {
  const altitudes = [100, 120, 140, 160, 180]
  const speeds = [8, 8.5, 9, 9.5, 10]
  const heartRates = [120, 130, 140, 150, 160]
  return altitudes.map((altitude, index) =>
    makeRecord({
      timestamp: index * 10,
      distance: index * 100,
      altitude,
      speed: speeds[index],
      heartRate: heartRates[index],
    }),
  )
}

/** mock 容器尺寸让 Recharts 在 jsdom 中正常渲染（left/top 必须为 0，指针坐标换算依赖） */
function mockChartLayout() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 220,
  } as DOMRect)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('availableMetrics', () => {
  it('只返回有数据的指标且按展示顺序（海拔居首）', () => {
    const records = [makeRecord({ timestamp: 0, heartRate: 120, speed: 8 })]
    expect(availableMetrics(records)).toEqual(['speed', 'heartRate'])
  })

  it('无任何指标数据时返回空数组', () => {
    expect(availableMetrics([makeRecord({ timestamp: 0 })])).toEqual([])
  })
})

describe('buildMultiMetricSeries', () => {
  it('各指标共用同一 x 基准，缺失点保留 undefined', () => {
    const records = [
      makeRecord({ timestamp: 0, distance: 0, altitude: 100, speed: 8 }),
      makeRecord({ timestamp: 10, distance: 100, altitude: 120 }), // 速度缺失
      makeRecord({ timestamp: 20, distance: 200, speed: 9 }), // 海拔缺失
    ]
    const series = buildMultiMetricSeries(records, ['altitude', 'speed'], 'distance')
    expect(series).toHaveLength(3)
    expect(series[1].values).toEqual({ altitude: 120, speed: undefined })
    expect(series[2].values).toEqual({ altitude: undefined, speed: 9 })
    expect(series.map((point) => point.x)).toEqual([0, 100, 200])
  })

  it('time 模式以距起点秒数为 x', () => {
    const series = buildMultiMetricSeries(makeRecords(), ['altitude'], 'time')
    expect(series.map((point) => point.x)).toEqual([0, 10, 20, 30, 40])
  })

  it('启用指标均无数据时返回空数组', () => {
    expect(buildMultiMetricSeries(makeRecords(), ['cadence'], 'distance')).toEqual([])
  })

  it('启用指标为空时返回空数组', () => {
    expect(buildMultiMetricSeries(makeRecords(), [], 'distance')).toEqual([])
  })
})

describe('buildMultiMetricRenderData（归一化）', () => {
  it('各指标归一化到 [0,1] 且原始值同点携带（Tooltip 用）', () => {
    const metrics = ['altitude', 'speed'] as const
    const series = buildMultiMetricSeries(makeRecords(), metrics, 'distance')
    const ranges = metricRanges(series, metrics)
    const data = buildMultiMetricRenderData(series, ranges, metrics)

    expect(data).toHaveLength(5)
    // 海拔 100→180：首点 0、末点 1
    expect(data[0][normDataKey('altitude')]).toBe(0)
    expect(data[4][normDataKey('altitude')]).toBe(1)
    // 速度 8→10：首点 0、末点 1
    expect(data[0][normDataKey('speed')]).toBe(0)
    expect(data[4][normDataKey('speed')]).toBe(1)
    // 原始值保留
    expect(data[2].altitude).toBe(140)
    expect(data[2].speed).toBe(9)
    expect(data[2].timestamp).toBe(20)
  })

  it('恒值指标归一化为 0.5，缺失点为 undefined', () => {
    const records = [
      makeRecord({ timestamp: 0, distance: 0, altitude: 100, heartRate: 140 }),
      makeRecord({ timestamp: 10, distance: 100, altitude: 110 }), // 心率缺失（海拔在，点保留）
      makeRecord({ timestamp: 20, distance: 200, altitude: 120, heartRate: 140 }),
    ]
    const metrics = ['altitude', 'heartRate'] as const
    const series = buildMultiMetricSeries(records, metrics, 'distance')
    const ranges = metricRanges(series, metrics)
    const data = buildMultiMetricRenderData(series, ranges, metrics)

    // 心率恒为 140（min === max）→ 有效点归一化为 0.5 居中
    expect(data[0][normDataKey('heartRate')]).toBe(0.5)
    // 缺失点归一化值为 undefined（断线），原始值亦为 undefined
    expect(data[1][normDataKey('heartRate')]).toBeUndefined()
    expect(data[1].heartRate).toBeUndefined()
    // 海拔正常归一化
    expect(data[0][normDataKey('altitude')]).toBe(0)
    expect(data[2][normDataKey('altitude')]).toBe(1)
  })
})

describe('MultiMetricChart', () => {
  it('默认显示海拔曲线：海拔 chip 开启，无数据指标不出开关', async () => {
    mockChartLayout()
    const { container } = render(<MultiMetricChart records={makeRecords()} />)

    expect(screen.getByText('数据曲线')).toBeInTheDocument()
    // 有数据的指标（海拔/速度/心率）出开关，踏频/功率/温度无数据不出
    expect(screen.getByRole('button', { name: '海拔' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '速度' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: '踏频' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '功率' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '温度' })).not.toBeInTheDocument()
    // 默认渲染海拔面积曲线
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-area-curve').length).toBeGreaterThan(0)
    })
  })

  it('无海拔数据时默认开启第一个有数据的指标', () => {
    mockChartLayout()
    const records = [makeRecord({ timestamp: 0, distance: 0, speed: 8 })]
    render(<MultiMetricChart records={records} />)

    expect(screen.queryByRole('button', { name: '海拔' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '速度' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('点击指标开关叠加曲线：开启速度后新增折线', async () => {
    mockChartLayout()
    const { container } = render(<MultiMetricChart records={makeRecords()} />)

    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-area-curve').length).toBeGreaterThan(0)
    })
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '速度' }))
    expect(screen.getByRole('button', { name: '速度' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-line-curve').length).toBeGreaterThan(0)
    })
  })

  it('关闭全部指标时显示引导文案', () => {
    mockChartLayout()
    render(<MultiMetricChart records={makeRecords()} />)

    fireEvent.click(screen.getByRole('button', { name: '海拔' }))
    expect(screen.getByText('已关闭全部指标，点击上方开关查看曲线')).toBeInTheDocument()
  })

  it('无任何曲线数据时显示空态提示', () => {
    mockChartLayout()
    render(<MultiMetricChart records={[makeRecord({ timestamp: 0 })]} />)

    expect(screen.getByText('该活动没有曲线数据')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '指标开关' })).not.toBeInTheDocument()
  })

  it('悬停显示全部已开指标的真实数值并上报时间戳，移出后消失', async () => {
    mockChartLayout()
    const onHover = vi.fn()
    const { container } = render(
      <MultiMetricChart records={makeRecords()} onHover={onHover} />,
    )

    // 叠加速度曲线（悬停展示已开指标：海拔 + 速度）
    fireEvent.click(screen.getByRole('button', { name: '速度' }))
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-line-curve').length).toBeGreaterThan(0)
    })

    const wrapper = container.querySelector('.recharts-wrapper') as Element
    // 悬停到中部（≈ x 200，第 3 点：海拔 140 m、速度 9 m/s → 32.4 km/h）
    fireEvent.mouseMove(wrapper, { clientX: 400, clientY: 110 })

    const tooltip = await waitFor(() => {
      const node = container.querySelector('[data-testid="multi-metric-tooltip"]') as Element
      expect(node).not.toBeNull()
      return node
    })
    expect(tooltip).toHaveTextContent('海拔')
    expect(tooltip).toHaveTextContent('140 m')
    expect(tooltip).toHaveTextContent('速度')
    expect(tooltip).toHaveTextContent('32.4 km/h')
    // 共享时间轴：上报悬停点时间戳
    await waitFor(() => {
      expect(onHover).toHaveBeenCalledWith(expect.any(Number))
    })

    // 移出图表：悬浮卡消失并上报 undefined
    fireEvent.mouseLeave(wrapper)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="multi-metric-tooltip"]')).toBeNull()
    })
    expect(onHover).toHaveBeenLastCalledWith(undefined)
  })

  it('横轴支持距离/时间切换', async () => {
    mockChartLayout()
    render(<MultiMetricChart records={makeRecords()} />)

    fireEvent.click(screen.getByRole('button', { name: '时间' }))
    expect(screen.getByRole('button', { name: '时间' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '距离' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('MULTI_METRIC_META', () => {
  it('元数据字段唯一', () => {
    const fields = MULTI_METRIC_META.map((meta) => meta.field)
    expect(new Set(fields).size).toBe(fields.length)
  })
})
