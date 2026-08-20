/**
 * 爬坡分析区块测试（可视化版）：有爬坡渲染剖面图 + 级别徽章卡片，无爬坡不渲染。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ClimbSection from '@/features/activity/ClimbSection'
import type { ActivityRecord } from '@/types/activity'

/** 构造逐点记录（海拔持续爬升 4.5%：2000m 爬 90m；坐标带锯齿保证抽稀保留所有点） */
function makeClimbRecords(): ActivityRecord[] {
  return Array.from({ length: 21 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001 + (index % 2) * 0.0005,
    longitude: 121.5 + index * 0.001,
    altitude: 100 + index * 4.5,
    distance: index * 100,
  }))
}

/** 构造平路记录（含坐标） */
function makeFlatRecords(): ActivityRecord[] {
  return Array.from({ length: 3 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001,
    longitude: 121.5,
    altitude: 100,
    distance: index * 100,
  }))
}

describe('爬坡分析区块', () => {
  it('有爬坡时渲染坡度着色剖面 + 级别徽章 + 卡片（距离/爬升/坡度）', () => {
    const { container } = render(<ClimbSection records={makeClimbRecords()} distanceUnit="km" />)

expect(screen.getByText('爬坡分析')).toBeInTheDocument()
    expect(screen.getByText(/共 1 段爬坡/)).toBeInTheDocument()
    // 海拔剖面 SVG：存在坡度着色折线
    expect(container.querySelector('.climb-section__profile polyline')).not.toBeNull()
    // 2km 4.5% 坡度 → score=9000 → UCI 4 级：剖面徽章 + 卡片徽章
    expect(screen.getAllByText('4 级').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/2\.00 km/)).toBeInTheDocument()
    expect(screen.getByText(/90 m · 均 4\.5%/)).toBeInTheDocument()
    // 坡度色阶图例
    expect(container.querySelector('.climb-section__legend')).not.toBeNull()
  })

  it('无爬坡时不渲染区块', () => {
    render(<ClimbSection records={makeFlatRecords()} distanceUnit="km" />)

    expect(screen.queryByText('爬坡分析')).toBeNull()
  })

  it('鼠标悬停剖面时上报所在点时间戳并渲染参考线，移出后清除', async () => {
    const onHover = vi.fn()
    const { container } = render(
      <ClimbSection records={makeClimbRecords()} distanceUnit="km" onHover={onHover} />,
    )
    const svg = container.querySelector('.climb-section__profile') as Element
    // jsdom 无真实布局：固定宽高，便于把 clientX 换算成距离
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 140 }) as DOMRect

    const user = userEvent.setup()
    // 移到 200px 处（视口 x=50 → 距离 = 50% × 2000m = 1000m → 最近记录 index 10，时间戳 100）
    await user.pointer([{ pointerName: 'mouse', target: svg, coords: { clientX: 200 } }])

    expect(onHover).toHaveBeenCalledWith(100)
    // 悬停参考线出现
    expect(container.querySelector('.climb-section__profile line')).not.toBeNull()

    // 移出剖面：清除参考线并上报 undefined
    await user.unhover(svg)

    expect(onHover).toHaveBeenLastCalledWith(undefined)
    expect(container.querySelector('.climb-section__profile line')).toBeNull()
  })

  it('外部悬停时间戳渲染参考线（共享时间轴联动）', () => {
    const { container, rerender } = render(
      <ClimbSection records={makeClimbRecords()} distanceUnit="km" hoverTimestamp={150} />,
    )

    // index 15（距离 1500m，x=75）→ 参考线出现
    expect(container.querySelector('.climb-section__profile line')).not.toBeNull()
    expect(container.querySelector('.climb-section__profile line')!.getAttribute('x1')).toBe(
      '75',
    )

    // 无悬停时间戳时不渲染参考线
    rerender(<ClimbSection records={makeClimbRecords()} distanceUnit="km" />)
    expect(container.querySelector('.climb-section__profile line')).toBeNull()
  })
})
