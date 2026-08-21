/**
 * 骑行日历页面渲染测试（规格 §29）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb，写入数据后断言
 * 网格格子数量/颜色档位/工具提示/年份切换，以及空状态与加载失败提示。
 * 测试数据围绕"今天"动态构造，避免日期漂移。
 */
import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { buildYearGrid } from '@/features/calendar/calendarData'
import { formatDate } from '@/utils/format'
import type { Activity } from '@/types/activity'
import CalendarPage from '@/pages/CalendarPage'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

beforeEach(async () => {
  // 清空活动表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * 生成测试活动（本地时区）。
 *
 * @param index 序号（用于生成唯一 ID/指纹）
 * @param startTime 开始时间（ISO 8601）
 * @param distance 距离（米）
 * @param duration 时长（秒）
 * @param elevationGain 爬升（米）
 */
function makeActivity(
  index: number,
  startTime: string,
  distance = 10000,
  duration = 3600,
  elevationGain = 100,
): Activity {
  return {
    id: `act-${index}`,
    fileId: `file-${index}`,
    fileName: `ride-${index}.fit`,
    fingerprint: `fp-${index}`,
    activityType: 'cycling',
    startTime,
    endTime: startTime,
    duration,
    elapsedTime: duration,
    distance,
    elevationGain,
  }
}

describe('骑行日历页面', () => {
  it('展示当年日历网格：格子数量、颜色档位、工具提示', async () => {
    const repo = new DexieActivityRepository(testDb)
    const today = new Date()
    // 今天两次骑行：50000 + 77400 m → 4 档（127.40 km）
    // 取今天零点与当前时刻：保证是"已过去"的时间，不被聚合的未来活动过滤排除
    // （固定写 8 点/10 点会在 10 点前运行测试时落入未来，CI 为 UTC 时区必现）
    const startTimes = [
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString(),
      today.toISOString(),
    ]
    await repo.addActivities([
      makeActivity(0, startTimes[0], 50000, 5400, 300),
      makeActivity(1, startTimes[1], 77400, 10920, 945),
    ])
    const { container } = render(<CalendarPage />)

    // 网格渲染：格子总数 = 当年网格行 × 7
    await waitFor(() => {
      expect(container.querySelectorAll('[data-date]').length).toBeGreaterThan(0)
    })
    const cells = container.querySelectorAll('[data-date]')
    const expectedCount = buildYearGrid(today.getFullYear(), new Map()).flat().length
    expect(cells).toHaveLength(expectedCount)

    // 今日格子：最高档 + 完整工具提示
    const dateKey = formatDate(startTimes[0])
    const cell = container.querySelector(`[data-date="${dateKey}"]`)
    expect(cell).toHaveAttribute('data-level', '4')
    expect(cell).toHaveAttribute(
      'title',
      `${dateKey} / 2 次骑行 / 127.40 km / 04:32:00 / +1245 m`,
    )
  })

  it('展示年度汇总统计卡片（总距离/骑行天数/次数等）', async () => {
    const repo = new DexieActivityRepository(testDb)
    const today = new Date()
    const morning = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    await repo.addActivities([
      makeActivity(0, morning, 50000, 5400, 300),
      makeActivity(1, today.toISOString(), 30000, 3600, 100),
    ])
    render(<CalendarPage />)

    const stats = await screen.findByRole('region', {
      name: `${today.getFullYear()} 年度汇总`,
    })
    // 同日两次活动：骑行天数 1、次数 2、总距离 80 km
    expect(within(stats).getByText('总距离').parentElement).toHaveTextContent('80.00 km')
    expect(within(stats).getByText('骑行天数').parentElement).toHaveTextContent('1 天')
    expect(within(stats).getByText('骑行次数').parentElement).toHaveTextContent('2 次')
    expect(within(stats).getByText('最长单日').parentElement).toHaveTextContent('80.00 km')
  })

  it('可切换上一年/下一年', async () => {
    const user = userEvent.setup()
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivities([makeActivity(0, new Date().toISOString(), 10000)])
    render(<CalendarPage />)

    const year = new Date().getFullYear()
    expect(await screen.findByText(String(year))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下一年' }))
    expect(screen.getByText(String(year + 1))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '上一年' }))
    expect(screen.getByText(String(year))).toBeInTheDocument()
  })

  it('点击格子展开当日活动面板：活动链接跳详情，可关闭', async () => {
    const user = userEvent.setup()
    const repo = new DexieActivityRepository(testDb)
    const today = new Date()
    const morning = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    await repo.addActivities([
      makeActivity(0, morning, 50000, 5400, 300),
      makeActivity(1, today.toISOString(), 30000, 3600, 100),
    ])
    // 有标题的活动面板显示标题，无标题回退文件名
    await testDb.activities.update('act-1', { name: '傍晚恢复骑' })
    render(<CalendarPage />, { wrapper: MemoryRouter })

    const dateKey = formatDate(morning)
    await user.click(await screen.findByRole('button', { name: `查看 ${dateKey} 骑行` }))

    const panel = await screen.findByRole('region', { name: '当日骑行' })
    expect(within(panel).getByText(`${dateKey} 骑行`)).toBeInTheDocument()
    expect(within(panel).getByText('傍晚恢复骑').closest('a')).toHaveAttribute(
      'href',
      '/activities/act-1',
    )
    expect(within(panel).getByText('ride-0.fit').closest('a')).toHaveAttribute(
      'href',
      '/activities/act-0',
    )
    // 面板展示距离与时长
    expect(within(panel).getByText(/50\.00 km/)).toBeInTheDocument()
    expect(within(panel).getByText(/01:30:00/)).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: '关闭当日面板' }))
    expect(screen.queryByRole('region', { name: '当日骑行' })).not.toBeInTheDocument()
  })

  it('无数据时展示导入引导文案', async () => {
    render(<CalendarPage />)

    expect(await screen.findByText(/欢迎使用/)).toBeInTheDocument()
    expect(screen.getByText(/同步骑行数据/)).toBeInTheDocument()
  })

  it('加载失败时展示错误提示', async () => {
    vi.spyOn(DexieActivityRepository.prototype, 'listAllSummaries').mockRejectedValue(
      new Error('db down'),
    )
    render(<CalendarPage />)

    expect(await screen.findByText(/加载失败/)).toBeInTheDocument()
  })
})
