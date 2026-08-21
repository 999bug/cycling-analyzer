/**
 * 骑行总结条组件测试（RideSummaryBanner）。
 *
 * 覆盖：类型徽章与总结文案渲染、质量档位短语展示、
 * 数据全缺时组件不渲染。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Activity } from '@/types/activity'
import RideSummaryBanner from '@/features/insights/RideSummaryBanner'

/** 基础活动摘要 */
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

describe('RideSummaryBanner', () => {
  it('渲染类型徽章与真实数据总结', () => {
    render(<RideSummaryBanner activity={makeActivity({ avgPower: 180 })} options={{ ftp: 250 }} />)

    expect(screen.getByText('耐力骑')).toBeInTheDocument()
    expect(screen.getByText(/60\.00 km/)).toBeInTheDocument()
    expect(screen.getByText(/2 小时/)).toBeInTheDocument()
  })

  it('有质量分时展示档位短语', () => {
    render(<RideSummaryBanner activity={makeActivity()} options={{ qualityScore: 90 }} />)

    expect(screen.getByText('数据质量 状态出色')).toBeInTheDocument()
  })

  it('无质量分时不渲染档位短语', () => {
    render(<RideSummaryBanner activity={makeActivity()} options={{}} />)

    expect(screen.queryByText(/数据质量/)).not.toBeInTheDocument()
  })

  it('距离与时长均缺失时不渲染（不伪造总结）', () => {
    const { container } = render(
      <RideSummaryBanner
        activity={makeActivity({ distance: undefined, duration: 0 })}
        options={{}}
      />,
    )

    expect(container.querySelector('.ride-summary')).toBeNull()
  })
})
