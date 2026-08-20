/**
 * 分段分析区块测试（可视化版）：有爬坡渲染分段卡片列表 + 对比洞察，无爬坡不渲染。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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

describe('分段分析区块', () => {
  it('渲染分段卡片列表：平路/爬坡交替，含距离范围与每段统计', () => {
    render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)

    expect(screen.getByText('分段分析')).toBeInTheDocument()
    // 分段类型标签（平路 1 / 爬坡 1 / 平路 2 / 爬坡 2 / 平路 3）
    expect(screen.getByText('平路 1')).toBeInTheDocument()
    expect(screen.getByText('爬坡 1')).toBeInTheDocument()
    expect(screen.getByText('爬坡 2')).toBeInTheDocument()
    // 爬坡 1 统计：速度 4 km/h→14.4、功率 200W
    expect(screen.getByText(/速度 14\.4 km\/h/)).toBeInTheDocument()
    expect(screen.getByText(/功率 200 W/)).toBeInTheDocument()
  })

  it('渲染相邻爬坡对比洞察', () => {
    render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)

    expect(screen.getByText(/爬坡 2比爬坡 1/)).toBeInTheDocument()
    expect(screen.getByText(/平均功率高/)).toBeInTheDocument()
    expect(screen.getByText(/但速度低/)).toBeInTheDocument()
  })

  it('无爬坡时不渲染区块', () => {
    render(<SegmentsSection records={makeFlatRecords()} distanceUnit="km" />)

    expect(screen.queryByText('分段分析')).toBeNull()
  })
})