/**
 * 分段详情区块测试。
 *
 * - 默认 5km 段长渲染表格（段/距离/用时/时速/平均心率）；
 * - 切换 1km 段长行数变化；
 * - 英制单位显示 mi/mph；
 * - 无距离数据时区块不渲染。
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import SplitsSection from '@/features/activity/SplitsSection'
import type { ActivityRecord } from '@/types/activity'

/** 构造等距记录：每点 100m、10s、心率 140（共 12km） */
function makeRecords(): ActivityRecord[] {
  return Array.from({ length: 121 }, (_, i) => ({
    timestamp: i * 10,
    distance: i * 100,
    heartRate: 140,
  }))
}

describe('分段详情区块', () => {
  it('默认 5km 段长：12km 活动渲染 3 行（末段 2.00 km）', () => {
    render(<SplitsSection records={makeRecords()} distanceUnit="km" />)

    const table = within(screen.getByRole('region', { name: '分段详情' })).getByRole('table')
    const rows = within(table).getAllByRole('row')
    // 表头 1 行 + 3 段
    expect(rows).toHaveLength(4)
    expect(within(rows[3]).getByText('2.00 km')).toBeInTheDocument()
    expect(within(rows[1]).getByText('00:08:20')).toBeInTheDocument()
    expect(within(rows[1]).getByText('36.0 km/h')).toBeInTheDocument()
    expect(within(rows[1]).getByText('140 bpm')).toBeInTheDocument()
  })

  it('切换 1km 段长后渲染 12 行', async () => {
    const user = userEvent.setup()
    render(<SplitsSection records={makeRecords()} distanceUnit="km" />)

    await user.click(screen.getByRole('button', { name: '1 公里' }))

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(13)
    expect(screen.getByRole('button', { name: '1 公里' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('英制单位显示 mi 与 mph', () => {
    render(<SplitsSection records={makeRecords()} distanceUnit="mi" />)

    expect(screen.getAllByText('3.11 mi').length).toBeGreaterThan(0)
    expect(screen.getAllByText('22.4 mph').length).toBeGreaterThan(0)
  })

  it('无距离数据时区块不渲染', () => {
    const { container } = render(
      <SplitsSection records={[{ timestamp: 0 }, { timestamp: 10 }]} distanceUnit="km" />,
    )

    expect(container.firstChild).toBeNull()
  })
})
