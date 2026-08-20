/**
 * 爬坡分析区块测试（可视化版）：有爬坡渲染剖面图 + 级别徽章卡片，无爬坡不渲染。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ClimbSection from '@/features/activity/ClimbSection'
import type { ActivityRecord } from '@/types/activity'

/** 构造逐点记录（海拔持续爬升 4.5%：2000m 爬 90m；含坐标供抽稀） */
function makeClimbRecords(): ActivityRecord[] {
  return Array.from({ length: 21 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001,
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
  it('有爬坡时渲染剖面图 + 级别卡片（距离/爬升/坡度）', () => {
    const { container } = render(<ClimbSection records={makeClimbRecords()} distanceUnit="km" />)

expect(screen.getByText('爬坡分析')).toBeInTheDocument()
    expect(screen.getByText(/共 1 段爬坡/)).toBeInTheDocument()
    // 海拔剖面 SVG
    expect(container.querySelector('.climb-section__profile polyline')).not.toBeNull()
    // 2km 4.5% 坡度 → score=9000 → UCI 4 级
    expect(screen.getByText('4 级')).toBeInTheDocument()
    expect(screen.getByText(/2\.00 km/)).toBeInTheDocument()
    expect(screen.getByText(/90 m · 均 4\.5%/)).toBeInTheDocument()
  })

  it('无爬坡时不渲染区块', () => {
    render(<ClimbSection records={makeFlatRecords()} distanceUnit="km" />)

    expect(screen.queryByText('爬坡分析')).toBeNull()
  })
})
