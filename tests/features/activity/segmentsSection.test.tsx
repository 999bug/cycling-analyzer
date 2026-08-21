/**
 * 合并版「爬坡与分段分析」区块测试（爬坡分析 + 分段分析合并）。
 *
 * 覆盖：平路/爬坡全量分段卡片 + 海拔剖面（坡度着色折线 + 色带 + UCI 徽章 + 图例）、
 * 卡片↔色带悬浮联动、共享时间轴（悬停上报时间戳 / 外部参考线）、无爬坡不渲染。
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
  it('渲染平路 + 爬坡全量分段卡片与摘要（平路段正常展示）', () => {
    render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)

    expect(screen.getByText('爬坡与分段分析')).toBeInTheDocument()
    // 摘要：爬坡/平路计数
    expect(screen.getByText(/共 2 段爬坡、3 段平路/)).toBeInTheDocument()
    // 分段类型标签（平路 1 / 爬坡 1 / 平路 2 / 爬坡 2 / 平路 3）
    expect(screen.getByText('平路 1')).toBeInTheDocument()
    expect(screen.getByText('爬坡 1')).toBeInTheDocument()
    expect(screen.getByText('爬坡 2')).toBeInTheDocument()
    // 爬坡 1 统计：速度 4 km/h→14.4、功率 200W
    expect(screen.getByText(/速度 14\.4 km\/h/)).toBeInTheDocument()
    expect(screen.getByText(/功率 200 W/)).toBeInTheDocument()
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

  it('悬停分段卡片 → 卡片高亮 + 剖面对应色带高亮', async () => {
    const user = userEvent.setup()
    const { container } = render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)

    const cards = container.querySelectorAll('[data-testid^="segment-card-"]')
    expect(cards.length).toBe(5)
    // 悬停爬坡 1 卡片（下标 1）
    await user.hover(cards[1])
    expect(cards[1].classList.contains('segment-card--active')).toBe(true)
    // 剖面对应色带高亮
    expect(
      container.querySelector('[data-testid="segment-band"].segments-section__band--climb.segments-section__band--active'),
    ).not.toBeNull()

    // 移出卡片：高亮清除
    await user.unhover(cards[1])
    expect(container.querySelector('.segments-section__band--active')).toBeNull()
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