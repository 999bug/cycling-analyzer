/**
 * 活动轨迹地图测试（全屏查看 + 起终点标识）。
 *
 * - 渲染全屏按钮、起点圆点与终点黑白格旗标；
 * - 点击全屏按钮对包裹层调用 requestFullscreen（jsdom 未实现 Fullscreen API，补 stub）；
 * - 着色模式下仍渲染地图。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
