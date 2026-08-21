/**
 * 合并版「爬坡与分段分析」区块测试（爬坡分析 + 分段分析合并）。
 *
 * 覆盖：海拔剖面（坡度着色折线 + 色带 + UCI 徽章 + 图例）、剖面悬停详情卡
 * （分段标签/区间/爬升/坡度/速度/功率/心率）、共享时间轴（悬停上报时间戳 /
 * 外部参考线）、无爬坡不渲染。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SegmentsSection from '@/features/activity/SegmentsSection'
import type { ActivityRecord } from '@/types/activity'

/** 构造逐点记录：平路 → 爬坡 → 下坡断开 → 第二段爬坡（两段爬坡功率/速度不同） */
function makeTwoClimbRecords(): ActivityRecord[] {
  return [
    [0, 100, 8, 150, 120],
    [250, 100, 8, 150, 120],
    [500, 100, 8, 150, 120],
    [750, 100, 8, 150, 120],
    [1000, 100, 4, 200, 150],
    [1250, 125, 4, 200, 150],
    [1500, 150, 4, 200, 150],
    [1750, 175, 4, 200, 150],
    [2000, 200, 4, 200, 150],
    [2500, 175, 6, 150, 130],
    [3000, 150, 3, 240, 160],
    [3250, 175, 3, 240, 160],
    [3500, 200, 3, 240, 160],
    [3750, 225, 3, 240, 160],
    [4000, 250, 3, 240, 160],
    [4500, 250, 8, 150, 120],
    [5000, 250, 8, 150, 120],
  ].map(([distance, altitude, speed, power, heartRate], index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001,
    longitude: 121.5 + index * 0.001,
    distance,
    altitude,
    speed,
    power,
    heartRate,
  }))
}

/** 构造平路记录（无爬坡） */
function makeFlatRecords(): ActivityRecord[] {
  return Array.from({ length: 3 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001,
    longitude: 121.5,
    altitude: 100,
    distance: index * 100,
  }))
}

/** 单爬坡记录（海拔持续爬升 4.5%：2km 爬 90m） */
function makeSingleClimbRecords(): ActivityRecord[] {
  return Array.from({ length: 21 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001 + (index % 2) * 0.0005,
    longitude: 121.5 + index * 0.001,
    altitude: 100 + index * 4.5,
    distance: index * 100,
  }))
}

describe('爬坡与分段分析区块', () => {
  it('渲染剖面摘要与色阶图例（分段详情收进悬停卡，无卡片列表）', () => {
    const { container } = render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)

    expect(screen.getByText('爬坡与分段分析')).toBeInTheDocument()
    // 摘要：爬坡/平路计数
    expect(screen.getByText(/共 2 段爬坡、3 段平路/)).toBeInTheDocument()
    // 坡度色阶图例
    expect(container.querySelector('.segments-section__legend')).not.toBeNull()
    // 未悬停时不显示悬浮卡，且不再渲染分段卡片列表
    expect(container.querySelector('[data-testid="segment-tooltip"]')).toBeNull()
    expect(container.querySelector('.segment-list')).toBeNull()
  })

  it('海拔剖面：坡度着色折线 + 平路/爬坡色带 + UCI 徽章 + 图例', () => {
    const { container } = render(<SegmentsSection records={makeSingleClimbRecords()} distanceUnit="km" />)

    // 坡度着色折线 + 色带（SVG）
    expect(container.querySelectorAll('.segments-section__profile polyline').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-testid="segment-band"]').length).toBeGreaterThan(0)
    // UCI 徽章：2km × 4.5% = 9000 → 4 级
    expect(screen.getAllByText('4 级').length).toBeGreaterThan(0)
    // 图例
    expect(container.querySelector('.segments-section__legend')).not.toBeNull()
  })

  it('悬停剖面：显示分段详情悬浮卡（含区间/爬升/坡度/速度/功率/心率）', async () => {
    const { container } = render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)
    const svg = container.querySelector('.segments-section__profile') as Element
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 140 }) as DOMRect

    const user = userEvent.setup()
    // 移到 100px 处（视口 x=25 → 距离 1250m → 爬坡 1 段内）
    await user.pointer([{ pointerName: 'mouse', target: svg, coords: { clientX: 100 } }])

    const tooltip = container.querySelector('[data-testid="segment-tooltip"]') as Element
    expect(tooltip).not.toBeNull()
    // 悬浮卡标题为当前分段标签
    expect(tooltip).toHaveTextContent('爬坡 1')
    // 区间与长度行
    expect(tooltip).toHaveTextContent('区间')
    expect(tooltip).toHaveTextContent('1.00 km – 2.00 km')
    expect(tooltip).toHaveTextContent('长度')
    expect(tooltip).toHaveTextContent('1.00 km')
    // 爬坡段特有行：爬升 100m、坡度 10.0%
    expect(tooltip).toHaveTextContent('爬升')
    expect(tooltip).toHaveTextContent('100 m')
    expect(tooltip).toHaveTextContent('坡度')
    expect(tooltip).toHaveTextContent('10.0%')
    // 强度指标行（速度 4 m/s → 14.4 km/h、功率 200W、心率 150bpm）
    expect(tooltip).toHaveTextContent('14.4 km/h')
    expect(tooltip).toHaveTextContent('200 W')
    expect(tooltip).toHaveTextContent('150 bpm')

    // 移出剖面：悬浮卡消失
    await user.unhover(svg)
    expect(container.querySelector('[data-testid="segment-tooltip"]')).toBeNull()
  })

  it('悬停剖面：高亮所在分段色带并上报时间戳，移出后清除', async () => {
    const onHover = vi.fn()
    const { container } = render(
      <SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" onHover={onHover} />,
    )
    const svg = container.querySelector('.segments-section__profile') as Element
    // jsdom 无真实布局：固定宽高，便于把 clientX 换算成距离
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 140 }) as DOMRect

    const user = userEvent.setup()
    // 移到 100px 处（视口 x=25 → 距离 = 25% × 5000m = 1250m → 爬坡 1 段内）
    await user.pointer([{ pointerName: 'mouse', target: svg, coords: { clientX: 100 } }])

    expect(onHover).toHaveBeenCalledWith(expect.any(Number))
    // 爬坡 1 色带高亮
    expect(
      container.querySelector('[data-testid="segment-band"].segments-section__band--climb.segments-section__band--active'),
    ).not.toBeNull()
    // 悬停参考线出现
    expect(container.querySelector('[data-testid="hover-line"]')).not.toBeNull()

    // 移出剖面：清除高亮与参考线并上报 undefined
    await user.unhover(svg)
    expect(onHover).toHaveBeenLastCalledWith(undefined)
    expect(container.querySelector('[data-testid="hover-line"]')).toBeNull()
  })

  it('外部悬停时间戳渲染参考线（共享时间轴联动）', () => {
    const { container, rerender } = render(
      <SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" hoverTimestamp={150} />,
    )

    // 有外部时间戳时参考线出现
    expect(container.querySelector('[data-testid="hover-line"]')).not.toBeNull()

    // 无悬停时间戳时不渲染参考线
    rerender(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)
    expect(container.querySelector('[data-testid="hover-line"]')).toBeNull()
  })

  it('渲染相邻爬坡对比洞察', () => {
    render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)

    expect(screen.getByText(/爬坡 2比爬坡 1/)).toBeInTheDocument()
    expect(screen.getByText(/平均功率高/)).toBeInTheDocument()
    expect(screen.getByText(/但速度低/)).toBeInTheDocument()
  })

  it('无爬坡时不渲染区块', () => {
    render(<SegmentsSection records={makeFlatRecords()} distanceUnit="km" />)

    expect(screen.queryByText('爬坡与分段分析')).toBeNull()
  })
})