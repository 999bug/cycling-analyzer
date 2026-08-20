/**
 * 骑行质量评分区块测试（可视化版）：有数据渲染综合分 + 分项条 + 评价，无数据不渲染。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import QualityScoreSection from '@/features/analysis/QualityScoreSection'
import type { ActivityRecord } from '@/types/activity'

/** 构造稳定匀速记录（20 点，速度/功率/心率恒定 → 各分项满分） */
function makeSteadyRecords(): ActivityRecord[] {
  return Array.from({ length: 20 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001,
    longitude: 121.5 + index * 0.001,
    distance: index * 100,
    altitude: 100,
    speed: 8,
    power: 200,
    heartRate: 150,
  }))
}

/** 构造无指标记录（无速度/功率/心率） */
function makeEmptyRecords(): ActivityRecord[] {
  return Array.from({ length: 20 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2,
    longitude: 121.5,
    distance: index * 100,
    altitude: 100,
  }))
}

describe('骑行质量评分区块', () => {
  it('有数据时渲染综合评分、分项得分条与总体评价', () => {
    render(<QualityScoreSection records={makeSteadyRecords()} />)

    expect(screen.getByText('综合评分')).toBeInTheDocument()
    // 综合分 + 4 个分项均为 100（整体 + 配速/心率/功率/后程）
    expect(screen.getAllByText('100')).toHaveLength(5)
    // 各分项（配速/心率/功率/后程；无爬坡 → 爬坡表现不渲染）
    expect(screen.getByText('配速稳定性')).toBeInTheDocument()
    expect(screen.getByText('心率控制')).toBeInTheDocument()
    expect(screen.getByText('功率稳定性')).toBeInTheDocument()
    expect(screen.getByText('后程状态')).toBeInTheDocument()
    expect(screen.queryByText('爬坡表现')).toBeNull()
    expect(screen.getByText(/状态出色/)).toBeInTheDocument()
  })

  it('无任何指标数据时不渲染区块', () => {
    render(<QualityScoreSection records={makeEmptyRecords()} />)

    expect(screen.queryByText('综合评分')).toBeNull()
    expect(screen.queryByText('配速稳定性')).toBeNull()
  })
})