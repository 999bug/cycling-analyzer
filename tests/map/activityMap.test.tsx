/**
 * 活动轨迹地图测试（全屏查看 + 起终点标识 + 尺寸变化重新适配视野）。
 *
 * - 渲染全屏按钮、起点圆点与终点黑白格旗标；
 * - 点击全屏按钮对包裹层调用 requestFullscreen（jsdom 未实现 Fullscreen API，补 stub）；
 * - 着色模式下仍渲染地图；
 * - 容器尺寸变化（全屏进出/窗口缩放）重新 fitBounds，用户手动操作后不再强行拉回。
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Map as LeafletMap } from 'leaflet'
import ActivityMap from '@/map/ActivityMap'
import type { RoutePoint } from '@/types/activity'

// jsdom 未实现 Fullscreen API：补 stub（文件级，每个测试文件独立 jsdom 环境）
const requestFullscreenStub = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
Element.prototype.requestFullscreen = requestFullscreenStub

/** 构造两个坐标点（满足最小可绘制轨迹） */
const TWO_POINTS: RoutePoint[] = [
  { timestamp: 0, latitude: 31.2, longitude: 121.5 },
  { timestamp: 10, latitude: 31.201, longitude: 121.501 },
]

describe('活动轨迹地图', () => {
  it('渲染全屏按钮与起终点标识（终点为黑白格旗标）', () => {
    const { container } = render(<ActivityMap points={TWO_POINTS} />)

    expect(screen.getByRole('button', { name: '全屏查看' })).toBeInTheDocument()
    // 终点黑白格旗标（divIcon）
    expect(container.querySelector('.activity-map__finish-marker')).not.toBeNull()
  })

  it('点击全屏按钮对包裹层调用 requestFullscreen', async () => {
    requestFullscreenStub.mockClear()
    const { container } = render(<ActivityMap points={TWO_POINTS} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '全屏查看' }))

    expect(requestFullscreenStub).toHaveBeenCalledTimes(1)
    // 调用对象为全屏包裹层（地图外层 div）
    expect(requestFullscreenStub.mock.contexts[0]).toBe(
      container.querySelector('.map-fullscreen-wrapper'),
    )
  })

  it('轨迹点不足时显示占位提示，不渲染全屏按钮', () => {
    render(<ActivityMap points={[{ timestamp: 0, latitude: 31.2, longitude: 121.5 }]} />)

    expect(screen.getByText('该活动没有坐标轨迹')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全屏查看' })).toBeNull()
  })

  it('传入 hoverPoint 时渲染悬停圆点（爬坡剖面联动）', () => {
    const { container } = render(
      <ActivityMap
        points={TWO_POINTS}
        hoverPoint={{ latitude: 31.2, longitude: 121.5 }}
      />,
    )

    // react-leaflet CircleMarker 以 circle 元素输出，取 radius=7 的悬停圆点
    const hoverCircles = Array.from(container.querySelectorAll('.leaflet-overlay-pane circle'))
    const hoverCircle = hoverCircles.find((circle) => circle.getAttribute('r') === '7')
    expect(hoverCircle).not.toBeNull()
  })

  it('不传 hoverPoint 时不渲染悬停圆点', () => {
    const { container } = render(<ActivityMap points={TWO_POINTS} />)

    const hoverCircles = Array.from(container.querySelectorAll('.leaflet-overlay-pane circle'))
    expect(hoverCircles.some((circle) => circle.getAttribute('r') === '7')).toBe(false)
  })
})

describe('尺寸变化时重新适配视野', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('容器 resize（全屏进出/窗口缩放）后重新 fitBounds', () => {
    const fitBounds = vi.spyOn(LeafletMap.prototype, 'fitBounds')
    render(<ActivityMap points={TWO_POINTS} />)

    // MapContainer 的 bounds 属性也会触发一次，取渲染后的基线
    const baseline = fitBounds.mock.calls.length
    expect(baseline).toBeGreaterThan(0)
    // 从 fitBounds 的 this 上取到地图实例（jsdom 无真实尺寸，无法经 DOM 触发 resize）
    const map = fitBounds.mock.contexts[0] as LeafletMap

    act(() => {
      map.fire('resize', { oldSize: undefined, newSize: undefined })
    })

    expect(fitBounds.mock.calls.length).toBe(baseline + 1)
  })

  it('用户手动拖拽过地图后，尺寸变化不再强行适配（不打断用户）', () => {
    const fitBounds = vi.spyOn(LeafletMap.prototype, 'fitBounds')
    render(<ActivityMap points={TWO_POINTS} />)
    const map = fitBounds.mock.contexts[0] as LeafletMap
    const baseline = fitBounds.mock.calls.length

    act(() => {
      map.fire('dragstart')
      map.fire('resize', { oldSize: undefined, newSize: undefined })
    })

    expect(fitBounds.mock.calls.length).toBe(baseline)
  })

  it('切换轨迹后重置用户操作标记，尺寸变化重新适配', () => {
    const fitBounds = vi.spyOn(LeafletMap.prototype, 'fitBounds')
    const { rerender } = render(<ActivityMap points={TWO_POINTS} />)
    const map = fitBounds.mock.contexts[0] as LeafletMap

    act(() => {
      map.fire('dragstart')
    })

    // 换一条轨迹（新的坐标数组）→ 重新适配并把用户操作标记清零
    const nextPoints: RoutePoint[] = [
      { timestamp: 0, latitude: 30.1, longitude: 120.1 },
      { timestamp: 10, latitude: 30.2, longitude: 120.2 },
    ]
    rerender(<ActivityMap points={nextPoints} />)
    const baseline = fitBounds.mock.calls.length

    act(() => {
      map.fire('resize', { oldSize: undefined, newSize: undefined })
    })

    expect(fitBounds.mock.calls.length).toBe(baseline + 1)
  })

  it('导出录制态：包裹层挂舞台类、地图容器挂录制画框类', () => {
    const { container, rerender } = render(<ActivityMap points={TWO_POINTS} />)
    expect(container.querySelector('.map-export-stage')).toBeNull()
    expect(container.querySelector('.map-export-frame')).toBeNull()

    rerender(<ActivityMap points={TWO_POINTS} exportStage />)
    expect(container.querySelector('.map-export-stage')).not.toBeNull()
    expect(container.querySelector('.map-export-frame')).not.toBeNull()
  })

  it('导出录制态忽略用户操作标记：拖过地图后尺寸变化仍重新适配', () => {
    const fitBounds = vi.spyOn(LeafletMap.prototype, 'fitBounds')
    const { rerender } = render(<ActivityMap points={TWO_POINTS} />)
    const map = fitBounds.mock.contexts[0] as LeafletMap

    // 用户先拖过地图（正常态下此后不再自动适配）
    act(() => {
      map.fire('dragstart')
    })
    act(() => {
      map.fire('resize', { oldSize: undefined, newSize: undefined })
    })
    expect(fitBounds.mock.calls.length).toBe(1)

    // 进入录制态：必须无条件重新适配，否则成片取景会停在用户拖拽的位置
    rerender(<ActivityMap points={TWO_POINTS} exportStage />)
    const baseline = fitBounds.mock.calls.length
    act(() => {
      map.fire('resize', { oldSize: undefined, newSize: undefined })
    })

    expect(fitBounds.mock.calls.length).toBe(baseline + 1)
  })
})
