/**
 * 骑行日历热力组件渲染测试（规格 §29）。
 *
 * 直接构造聚合数据渲染组件（不依赖 IndexedDB），断言格子数量、
 * 颜色档位（data-level）、工具提示（title）、跨年边缘淡化、年份切换回调。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CalendarHeatmap from '@/features/calendar/CalendarHeatmap'
import { buildCalendarData, buildYearGrid } from '@/features/calendar/calendarData'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/** 固定参考时间：2026-08-17 12:00 本地时间 */
const NOW = new Date(2026, 7, 17, 12)

/** 展示年份 */
const YEAR = 2026

/**
 * 构造本地时区 ISO 时间戳。
 *
 * @param year 年
 * @param month 月（1-12）
 * @param day 日
 * @param hour 时
 */
function iso(year: number, month: number, day: number, hour = 8): string {
  return new Date(year, month - 1, day, hour).toISOString()
}

/**
 * 构造测试活动摘要。
 *
 * @param id 活动 ID
 * @param startTime 开始时间（ISO 8601）
 * @param distance 距离（米）
 * @param duration 时长（秒）
 * @param elevationGain 爬升（米）
 */
function summary(
  id: string,
  startTime: string,
  distance = 10000,
  duration = 3600,
  elevationGain = 100,
): ActivitySummary {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime,
    endTime: startTime,
    duration,
    elapsedTime: duration,
    distance,
    elevationGain,
  }
}

describe('骑行日历热力组件', () => {
  it('渲染完整网格：格子数量与当年网格一致', () => {
    const data = buildCalendarData(
      [
        // 2026-08-16 两次骑行
        summary('a1', iso(2026, 8, 16, 8), 50000, 5400, 300),
        summary('a2', iso(2026, 8, 16, 18), 77400, 10920, 945),
      ],
      NOW,
    )
    const { container } = render(
      <CalendarHeatmap data={data} year={YEAR} onYearChange={() => {}} />,
    )

    const cells = container.querySelectorAll('[data-date]')
    expect(cells).toHaveLength(buildYearGrid(YEAR, data).flat().length)
  })

  it('颜色档位与工具提示：按当日总距离分档，title 含聚合详情', () => {
    const data = buildCalendarData(
      [
        // 当日 127400 m → 4 档；10000 m → 1 档；30000 m → 2 档
        summary('a1', iso(2026, 8, 16, 8), 50000, 5400, 300),
        summary('a2', iso(2026, 8, 16, 18), 77400, 10920, 945),
        summary('a3', iso(2026, 8, 15, 8), 10000, 1800, 50),
        summary('a4', iso(2026, 8, 14, 8), 30000, 3600, 150),
      ],
      NOW,
    )
    const { container } = render(
      <CalendarHeatmap data={data} year={YEAR} onYearChange={() => {}} />,
    )

    const cell16 = container.querySelector('[data-date="2026-08-16"]')
    expect(cell16).toHaveAttribute('data-level', '4')
    expect(cell16).toHaveAttribute(
      'title',
      '2026-08-16 / 2 次骑行 / 127.40 km / 04:32:00 / +1245 m',
    )

    const cell15 = container.querySelector('[data-date="2026-08-15"]')
    expect(cell15).toHaveAttribute('data-level', '1')
    expect(cell15).toHaveAttribute('title', '2026-08-15 / 1 次骑行 / 10.00 km / 00:30:00 / +50 m')

    const cell14 = container.querySelector('[data-date="2026-08-14"]')
    expect(cell14).toHaveAttribute('data-level', '2')

    // 无活动日：level 0 且无 title
    const cell13 = container.querySelector('[data-date="2026-08-13"]')
    expect(cell13).toHaveAttribute('data-level', '0')
    expect(cell13).not.toHaveAttribute('title')
  })

  it('跨年边缘格子带淡化标记（inYear=false → outside 类）', () => {
    const { container } = render(
      <CalendarHeatmap data={new Map()} year={YEAR} onYearChange={() => {}} />,
    )

    const outside = container.querySelector('[data-date="2025-12-28"]')
    expect(outside).toHaveClass('calendar-heatmap__cell--outside')
    const inYear = container.querySelector('[data-date="2026-01-01"]')
    expect(inYear).not.toHaveClass('calendar-heatmap__cell--outside')
  })

  it('渲染年份标题与图例', () => {
    render(<CalendarHeatmap data={new Map()} year={YEAR} onYearChange={() => {}} />)

    expect(screen.getByText(String(YEAR))).toBeInTheDocument()
    expect(screen.getByText('少')).toBeInTheDocument()
    expect(screen.getByText('多')).toBeInTheDocument()
  })

  it('点击上一年/下一年按钮触发年份切换回调', async () => {
    const user = userEvent.setup()
    const onYearChange = vi.fn()
    render(<CalendarHeatmap data={new Map()} year={YEAR} onYearChange={onYearChange} />)

    await user.click(screen.getByRole('button', { name: '下一年' }))
    expect(onYearChange).toHaveBeenCalledWith(2027)

    await user.click(screen.getByRole('button', { name: '上一年' }))
    expect(onYearChange).toHaveBeenCalledWith(2025)
  })
})
