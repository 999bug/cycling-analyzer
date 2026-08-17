/**
 * 统计页面渲染测试（规格 §28）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb，写入跨时间范围数据后
 * 断言默认本周指标、切换范围（全部/过去 12 个月/自定义）时指标变化、
 * 范围内无活动提示、空状态与加载失败提示。
 * 测试数据相对"今天"动态构造（上周日/上月 15 号/去年同日），避免日期漂移。
 */
import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import type { Activity } from '@/types/activity'
import StatisticsPage from '@/pages/StatisticsPage'

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
  // 逐点表独立清理：个人纪录的功率纪录扫描读取该表
  await testDb.activity_records.clear()
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
 * @param maxSpeed 最快速度（m/s）
 * @param maxPower 最高功率（W）
 */
function makeActivity(
  index: number,
  startTime: string,
  distance = 10000,
  duration = 3600,
  elevationGain = 100,
  maxSpeed?: number,
  maxPower?: number,
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
    maxSpeed,
    maxPower,
  }
}

/**
 * 构造本地时区 YYYY-MM-DD 日期键。
 *
 * @param date 日期
 */
function dateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 写入跨时间范围测试数据（任意日期下断言稳定）：
 * - act-0 今天：在本周/本月/今年/过去 12 个月/全部
 * - act-1 上周日：不在本周，在 12 个月/全部
 * - act-2 上月 15 号：不在本周/本月，在 12 个月/全部
 * - act-3 去年同日：12 个月窗口起点当天（含边界），仅在 12 个月/全部
 * - act-4 去年同日 - 1 天：仅在全部
 */
async function seedCrossRangeData(): Promise<void> {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const sinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday)
  const lastSunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1, 22)
  const lastMonth15 = new Date(today.getFullYear(), today.getMonth() - 1, 15, 8)
  const lastYearToday = new Date(today.getFullYear(), today.getMonth() - 12, today.getDate(), 8)
  const beforeLastYearToday = new Date(
    today.getFullYear(),
    today.getMonth() - 12,
    today.getDate() - 1,
    8,
  )

  const repo = new DexieActivityRepository(testDb)
  await repo.addActivities([
    makeActivity(0, today.toISOString(), 50000, 5400, 300, 12, 300),
    makeActivity(1, lastSunday.toISOString(), 20000, 1800, 200),
    makeActivity(2, lastMonth15.toISOString(), 30000, 7200, 400),
    makeActivity(3, lastYearToday.toISOString(), 15000, 2700, 100),
    makeActivity(4, beforeLastYearToday.toISOString(), 8000, 900, 50),
  ])
}

describe('统计页面', () => {
  it('默认展示本周指标，切换全部/过去 12 个月后指标变化', async () => {
    await seedCrossRangeData()
    render(<StatisticsPage />, { wrapper: MemoryRouter })

    // 默认本周：仅今天的活动
    const weekCount = await screen.findByText('1 次')
    expect(weekCount).toBeInTheDocument()
    // 「本周」同时出现在范围选择器 radio 与卡片标题
    expect(screen.getAllByText('本周').length).toBeGreaterThanOrEqual(2)
    // 本周唯一活动的极值指标（最快速度 / 最高功率）
    expect(screen.getByText('43.2 km/h')).toBeInTheDocument()
    expect(screen.getByText('300 W')).toBeInTheDocument()
    // 总距离 = 平均单次距离 = 最长骑行 = 50.00 km（统计卡 3 次）+ 个人纪录最远距离卡 1 次
    expect(screen.getAllByText('50.00 km')).toHaveLength(4)
    // 总爬升 = 单次最大爬升（统计卡 2 次）；个人纪录最多爬升取全时段最大（act-2 的 400 m）
    expect(screen.getAllByText('+300 m')).toHaveLength(2)
    expect(screen.getByText('+400 m')).toBeInTheDocument()

    // 切换全部：五个活动全部计入
    await userEvent.click(screen.getByRole('radio', { name: '全部' }))
    expect(await screen.findByText('5 次')).toBeInTheDocument()
    expect(screen.getByText('123.00 km')).toBeInTheDocument()

    // 切换过去 12 个月：排除去年同日 - 1 天的活动
    await userEvent.click(screen.getByRole('radio', { name: '过去 12 个月' }))
    expect(await screen.findByText('4 次')).toBeInTheDocument()
    expect(screen.getByText('115.00 km')).toBeInTheDocument()
  })

  it('自定义范围按起止日期过滤（含边界日），只显示选中范围内的活动', async () => {
    await seedCrossRangeData()
    render(<StatisticsPage />, { wrapper: MemoryRouter })
    await screen.findByText('1 次')

    // 选择自定义并填入"上月 1 号 ~ 上月最后一天"，仅上月 15 号的活动命中
    await userEvent.click(screen.getByRole('radio', { name: '自定义' }))
    const today = new Date()
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)

    fireEvent.change(screen.getByLabelText('开始'), { target: { value: dateKey(lastMonthStart) } })
    fireEvent.change(screen.getByLabelText('结束'), { target: { value: dateKey(lastMonthEnd) } })

    expect(await screen.findByText('1 次')).toBeInTheDocument()
    // 单活动范围内：总距离 = 平均单次 = 最长骑行 = 30.00 km（重复文本）
    expect(screen.getAllByText('30.00 km').length).toBeGreaterThanOrEqual(3)
    // 卡片标题展示当前范围标签（radio 中也有「自定义」，断言出现 2 处）
    expect(screen.getAllByText('自定义').length).toBeGreaterThanOrEqual(2)
  })

  it('范围内无活动时展示提示文案', async () => {
    const oldRide = new Date(new Date().getFullYear() - 5, 0, 1, 8)
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivities([makeActivity(0, oldRide.toISOString())])
    render(<StatisticsPage />, { wrapper: MemoryRouter })

    // 有数据但本周无活动 → 提示切换时间范围
    expect(await screen.findByText(/暂无骑行记录/)).toBeInTheDocument()
  })

  it('无数据时展示导入引导文案', async () => {
    render(<StatisticsPage />, { wrapper: MemoryRouter })

    expect(await screen.findByText(/欢迎使用/)).toBeInTheDocument()
    expect(screen.getByText(/同步骑行数据/)).toBeInTheDocument()
  })

  it('加载失败时展示错误提示', async () => {
    vi.spyOn(DexieActivityRepository.prototype, 'listAllSummaries').mockRejectedValue(
      new Error('db down'),
    )
    render(<StatisticsPage />, { wrapper: MemoryRouter })

    expect(await screen.findByText(/加载失败/)).toBeInTheDocument()
  })

  it('个人纪录区块：展示全时段骑行纪录与功率纪录（与范围选择无关）', async () => {
    const repo = new DexieActivityRepository(testDb)
    const today = new Date()
    const lastWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7, 8)
    const recordBase = Math.floor(lastWeek.getTime() / 1000)
    // act-0 今天（在默认本周范围内，无功率逐点）；act-1 上周（范围外，持全部纪录 + 功率逐点）
    await repo.addActivities([
      makeActivity(0, today.toISOString(), 20000, 1800, 200),
      {
        ...makeActivity(1, lastWeek.toISOString(), 50000, 5400, 300),
        records: Array.from({ length: 10 }, (_, index) => ({
          timestamp: recordBase + index,
          power: 300,
        })),
      },
    ])
    render(<StatisticsPage />, { wrapper: MemoryRouter })

    // 默认本周统计卡仅含 act-0（20.00 km）
    expect(await screen.findByText('1 次')).toBeInTheDocument()
    const recordsSection = screen.getByRole('region', { name: '个人纪录' })

    // 骑行纪录：最远距离由范围外的 act-1 保持，卡片链接到其详情页
    const distanceCard = within(recordsSection).getByText('最远距离').closest('a')
    expect(distanceCard).toHaveAttribute('href', '/activities/act-1')
    expect(within(distanceCard as HTMLElement).getByText('50.00 km')).toBeInTheDocument()

    // 功率纪录异步扫描完成后展示：10 点 1s 采样恒定 300W → 5 秒功率 300W
    const powerLabel = await within(recordsSection).findByText('5 秒功率')
    const powerCard = powerLabel.closest('a')
    expect(powerCard).toHaveAttribute('href', '/activities/act-1')
    expect(within(powerCard as HTMLElement).getByText('300 W')).toBeInTheDocument()
  })

  it('设备统计区块：按设备分组展示聚合指标，无设备信息显示提示', async () => {
    const repo = new DexieActivityRepository(testDb)
    const today = new Date().toISOString()
    await repo.addActivities([
      makeActivity(0, today, 30000, 3600, 200),
      makeActivity(1, today, 20000, 1800, 100),
    ])
    // act-0/act-1 落库后补设备信息（makeActivity 不含 device 字段）
    await testDb.activities.update('act-0', {
      device: { productName: 'Edge 840', manufacturer: 'Garmin' },
    })
    await testDb.activities.update('act-1', {
      device: { productName: 'Edge 840', manufacturer: 'Garmin' },
    })
    render(<StatisticsPage />, { wrapper: MemoryRouter })

    const deviceSection = await screen.findByRole('region', { name: '设备统计' })
    expect(await within(deviceSection).findByText('Edge 840')).toBeInTheDocument()
    expect(within(deviceSection).getByText('2 次')).toBeInTheDocument()
    expect(within(deviceSection).getByText('50.00 km')).toBeInTheDocument()
    expect(within(deviceSection).getByText('01:30:00')).toBeInTheDocument()
  })

  it('全部活动无设备信息时设备统计区块显示提示', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivities([makeActivity(0, new Date().toISOString())])
    render(<StatisticsPage />, { wrapper: MemoryRouter })

    const deviceSection = await screen.findByRole('region', { name: '设备统计' })
    expect(await within(deviceSection).findByText('暂无设备信息')).toBeInTheDocument()
  })
})
