/**
 * 骑行洞察区块测试（可视化版）：有数据渲染洞察列表，数据全缺不渲染。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RideInsightsSection from '@/features/insights/RideInsightsSection'
import type { Activity, ActivityRecord } from '@/types/activity'

/** 构造基础活动摘要 */
function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'test-id',
    fileId: 'file-id',
    fileName: 'test.fit',
    fingerprint: 'fp',
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00+08:00',
    endTime: '2026-08-01T10:00:00+08:00',
    duration: 7200,
    elapsedTime: 7300,
    distance: 60000,
    elevationGain: 300,
    ...overrides,
  }
}

/** 构造 40 点后程掉速记录（触发负面衰减洞察） */
function makeFadingRecords(): ActivityRecord[] {
  return Array.from({ length: 40 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.0001,
    longitude: 121.5 + index * 0.0001,
    distance: index * 100,
    speed: index >= 28 ? 5 : 8,
    power: 200,
    heartRate: 150,
  }))
}

describe('骑行洞察区块', () => {
  it('有数据时渲染区块标题与洞察条目', () => {
    render(<RideInsightsSection activity={makeActivity()} records={makeFadingRecords()} />)

    expect(screen.getByText('骑行洞察')).toBeInTheDocument()
    // 后程掉速 → 负面衰减洞察
    expect(screen.getByText('后程衰减')).toBeInTheDocument()
  })

  it('无逐点数据时仍渲染（概览兜底）', () => {
    render(<RideInsightsSection activity={makeActivity()} records={[]} />)

    expect(screen.getByText('骑行洞察')).toBeInTheDocument()
    expect(screen.getByText('骑行概览')).toBeInTheDocument()
  })

  it('距离与时长全缺时不渲染区块', () => {
    const activity = makeActivity({ distance: 0, duration: 0, elevationGain: undefined })
    const { container } = render(<RideInsightsSection activity={activity} records={[]} />)

    expect(container.firstChild).toBeNull()
  })
})
