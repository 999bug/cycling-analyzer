/**
 * 仪表盘页面渲染测试（规格 §13）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb，写入跨月数据后
 * 断言本周/本月/总计数值、趋势图渲染与粒度切换、空状态与加载失败提示。
 * 测试数据相对"今天"动态构造（本周一/上周日/上月），避免日期漂移。
 */
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import type { Activity } from '@/types/activity'
import DashboardPage from '@/pages/DashboardPage'

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

/**
 * 构造本地时区当天 00:00。
 *
 * @param date 参考日期
 */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

describe('仪表盘页面', () => {
  it('展示本周/本月/总计四项统计（跨月数据）', async () => {
    const today = new Date()
    const dayOfWeek = today.getDay()
    const sinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    // 本周一 00:00、上周日 22:00、上月 15 号 08:00（均为本地时区）
    const monday = startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday))
    const lastSunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1, 22)
    const lastMonth15 = new Date(today.getFullYear(), today.getMonth() - 1, 15, 8)

    const repo = new DexieActivityRepository(testDb)
    await repo.addActivities([
      makeActivity(0, monday.toISOString(), 50000, 5400, 300),
      makeActivity(1, lastSunday.toISOString(), 20000, 1800, 200),
      makeActivity(2, lastMonth15.toISOString(), 30000, 7200, 400),
    ])
    render(<DashboardPage />)

    // 本周：仅本周一的活动（周 = 周一起至今天）
    const weekSection = await screen.findByLabelText('本周')
    expect(within(weekSection).getByText('1 次')).toBeInTheDocument()
    expect(within(weekSection).getByText('50.00 km')).toBeInTheDocument()
    expect(within(weekSection).getByText('01:30:00')).toBeInTheDocument()
    expect(within(weekSection).getByText('+300 m')).toBeInTheDocument()

    // 本月：本周一 + 上周日（上周日跨月时仅剩本周一）
    const monthSection = screen.getByLabelText('本月')
    const lastSundayInMonth =
      lastSunday.getFullYear() === today.getFullYear() &&
      lastSunday.getMonth() === today.getMonth()
    expect(within(monthSection).getByText(lastSundayInMonth ? '2 次' : '1 次')).toBeInTheDocument()
    expect(
      within(monthSection).getByText(lastSundayInMonth ? '70.00 km' : '50.00 km'),
    ).toBeInTheDocument()

    // 总计：三个活动累计
    const totalSection = screen.getByLabelText('总计')
    expect(within(totalSection).getByText('3 次')).toBeInTheDocument()
    expect(within(totalSection).getByText('100.00 km')).toBeInTheDocument()
    expect(within(totalSection).getByText('04:00:00')).toBeInTheDocument()
    expect(within(totalSection).getByText('+900 m')).toBeInTheDocument()
  })

  it('渲染距离趋势图，Tab 可切换粒度', async () => {
    // jsdom 中 getBoundingClientRect 恒为 0，mock 容器尺寸让 Recharts 真实渲染 SVG
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 280,
    } as DOMRect)
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivities([makeActivity(0, new Date().toISOString(), 10000)])
    render(<DashboardPage />)

    const chart = await screen.findByRole('img', { name: '每日骑行距离柱状图' })
    expect(chart).toBeInTheDocument()
    expect(chart.querySelector('svg')).toBeInTheDocument()

    // 默认选中近 30 天
    const tab30 = screen.getByRole('tab', { name: '近 30 天' })
    expect(tab30).toHaveAttribute('aria-selected', 'true')

    // 切换到近一年
    const tabYear = screen.getByRole('tab', { name: '近一年' })
    await userEvent.click(tabYear)
    expect(tabYear).toHaveAttribute('aria-selected', 'true')
    expect(tab30).toHaveAttribute('aria-selected', 'false')
  })

  it('无数据时展示导入引导文案', async () => {
    render(<DashboardPage />)

    expect(await screen.findByText(/欢迎使用/)).toBeInTheDocument()
    expect(screen.getByText(/同步骑行数据/)).toBeInTheDocument()
  })

  it('加载失败时展示错误提示', async () => {
    vi.spyOn(DexieActivityRepository.prototype, 'listAllSummaries').mockRejectedValue(
      new Error('db down'),
    )
    render(<DashboardPage />)

    expect(await screen.findByText(/加载失败/)).toBeInTheDocument()
  })
})
