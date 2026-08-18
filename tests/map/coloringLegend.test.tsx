/**
 * 轨迹着色图例测试（规格 §16 辅助说明）。
 *
 * - 速度模式：固定域 0-15 m/s，公制显示 km/h，英制显示 mph；
 * - 海拔模式：值域取数据 min-max；
 * - 指标全部缺失时不渲染（地图同时回退单色轨迹）；
 * - 渐变条与轨迹色阶同源（COLORING_LEGEND_GRADIENT）。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ColoringLegend from '@/map/ColoringLegend'
import { COLORING_LEGEND_GRADIENT } from '@/map/routeColoring'
import type { RoutePoint } from '@/types/activity'

/** 构造带速度/心率/功率/海拔的轨迹点 */
function makePoints(overrides: Partial<RoutePoint>[] = []): RoutePoint[] {
  const base: RoutePoint[] = [
    { timestamp: 0, latitude: 31.2, longitude: 121.5, speed: 8, heartRate: 130, power: 180, altitude: 100 },
    { timestamp: 10, latitude: 31.201, longitude: 121.501, speed: 10, heartRate: 150, power: 220, altitude: 200 },
  ]
  return base.map((point, index) => ({ ...point, ...overrides[index] }))
}

describe('轨迹着色图例', () => {
  it('速度模式：固定域端点显示 km/h（0-15 m/s → 0-54 km/h）', () => {
    render(<ColoringLegend mode="speed" points={makePoints()} distanceUnit="km" />)

    expect(screen.getByLabelText('速度着色图例')).toBeInTheDocument()
    expect(screen.getByText('低 0.0 km/h')).toBeInTheDocument()
    expect(screen.getByText('高 54.0 km/h')).toBeInTheDocument()
  })

  it('速度模式：英制单位显示 mph', () => {
    render(<ColoringLegend mode="speed" points={makePoints()} distanceUnit="mi" />)

    expect(screen.getByText('低 0.0 mph')).toBeInTheDocument()
    expect(screen.getByText('高 33.6 mph')).toBeInTheDocument()
  })

  it('海拔模式：值域取数据 min-max', () => {
    render(<ColoringLegend mode="altitude" points={makePoints()} distanceUnit="km" />)

    expect(screen.getByLabelText('海拔着色图例')).toBeInTheDocument()
    expect(screen.getByText('低 100 m')).toBeInTheDocument()
    expect(screen.getByText('高 200 m')).toBeInTheDocument()
  })

  it('心率模式：固定域 60-200 bpm', () => {
    render(<ColoringLegend mode="heartRate" points={makePoints()} distanceUnit="km" />)

    expect(screen.getByText('低 60 bpm')).toBeInTheDocument()
    expect(screen.getByText('高 200 bpm')).toBeInTheDocument()
  })

  it('指标全部缺失时不渲染', () => {
    const { container } = render(
      <ColoringLegend
        mode="power"
        points={[{ timestamp: 0, latitude: 31.2, longitude: 121.5 }, { timestamp: 10, latitude: 31.201, longitude: 121.501 }]}
        distanceUnit="km"
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('渐变条与轨迹色阶同源（jetRamp 采样）', () => {
    render(<ColoringLegend mode="speed" points={makePoints()} distanceUnit="km" />)

    const bar = screen.getByRole('img', { name: '速度由低到高：蓝到红' })
    // 渐变串由 jetRamp 生成：蓝（hsl 220）起、红（hsl 0）止
    expect(bar.style.background).toContain('linear-gradient')
    expect(COLORING_LEGEND_GRADIENT).toContain('hsl(220')
    expect(COLORING_LEGEND_GRADIENT).toContain('hsl(0')
  })
})
