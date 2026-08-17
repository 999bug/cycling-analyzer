/**
 * 个人纪录区块测试（规格 §39 P2）。
 *
 * 断言：骑行纪录卡片（值/标签/日期/链接）、功率纪录三种状态
 * （计算中/无功率数据/就绪）、加载失败提示。
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import RecordCards from '@/features/records/RecordCards'
import type { PowerRecordEntry, RideRecordEntry } from '@/features/records/personalRecords'

/** 骑行纪录样例 */
const RIDE_RECORDS: RideRecordEntry[] = [
  { key: 'distance', value: 80000, activityId: 'act-b', startTime: '2026-08-05T08:00:00.000Z' },
  { key: 'duration', value: 9000, activityId: 'act-c', startTime: '2026-08-01T08:00:00.000Z' },
  { key: 'elevationGain', value: 900, activityId: 'act-b', startTime: '2026-08-05T08:00:00.000Z' },
]

/** 功率纪录样例 */
const POWER_RECORDS: PowerRecordEntry[] = [
  { duration: 5, power: 950, activityId: 'act-b', startTime: '2026-08-05T08:00:00.000Z' },
  { duration: 1200, power: 220, activityId: 'act-a', startTime: '2026-08-01T08:00:00.000Z' },
]

describe('RecordCards', () => {
  it('展示骑行纪录卡片：值、标签、达成日期与详情链接', () => {
    render(<RecordCards rideRecords={RIDE_RECORDS} powerRecords={[]} />, {
      wrapper: MemoryRouter,
    })

    expect(screen.getByText('个人纪录')).toBeInTheDocument()
    expect(screen.getByText('80.00 km')).toBeInTheDocument()
    expect(screen.getByText('最远距离')).toBeInTheDocument()
    expect(screen.getByText('02:30:00')).toBeInTheDocument()
    expect(screen.getByText('最长时长')).toBeInTheDocument()
    expect(screen.getByText('+900 m')).toBeInTheDocument()
    expect(screen.getAllByText('2026-08-05')).toHaveLength(2)

    // 卡片链接到达成纪录的活动详情页
    const link = screen.getByText('80.00 km').closest('a')
    expect(link).toHaveAttribute('href', '/activities/act-b')
  })

  it('功率纪录为 null 时显示计算中提示', () => {
    render(<RecordCards rideRecords={RIDE_RECORDS} powerRecords={null} />, {
      wrapper: MemoryRouter,
    })

    expect(screen.getByText('功率纪录计算中…')).toBeInTheDocument()
  })

  it('功率纪录为空时显示无功率数据提示', () => {
    render(<RecordCards rideRecords={RIDE_RECORDS} powerRecords={[]} />, {
      wrapper: MemoryRouter,
    })

    expect(screen.getByText(/暂无功率数据/)).toBeInTheDocument()
  })

  it('功率纪录加载失败时显示失败提示', () => {
    render(
      <RecordCards rideRecords={RIDE_RECORDS} powerRecords={null} powerRecordsFailed />,
      { wrapper: MemoryRouter },
    )

    expect(screen.getByText('功率纪录加载失败')).toBeInTheDocument()
  })

  it('展示功率纪录卡片：时长标签、功率值与链接', () => {
    render(<RecordCards rideRecords={RIDE_RECORDS} powerRecords={POWER_RECORDS} />, {
      wrapper: MemoryRouter,
    })

    expect(screen.getByText('950 W')).toBeInTheDocument()
    expect(screen.getByText('5 秒功率')).toBeInTheDocument()
    expect(screen.getByText('220 W')).toBeInTheDocument()
    expect(screen.getByText('20 分钟功率')).toBeInTheDocument()

    const link = screen.getByText('220 W').closest('a')
    expect(link).toHaveAttribute('href', '/activities/act-a')
  })
})
