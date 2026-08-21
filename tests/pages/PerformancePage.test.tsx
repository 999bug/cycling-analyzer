/**
 * 表现趋势页面渲染测试（规格 §39 表现趋势 / 每周训练综述）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb，写入跨周数据后
 * 断言周综述卡片（本周 vs 上周）与 12 周趋势图渲染；空数据/无 FTP 分支。
 */
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { saveSettings } from '@/features/settings/settings'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import type { Activity } from '@/types/activity'
import PerformancePage from '@/pages/PerformancePage'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 作者快照客户端假实现（getProfile 返回空配置） */
const mockSnapshotClient = vi.hoisted(() => ({
  getManifest: vi.fn(),
  getActivities: vi.fn(async () => [] as unknown[]),
  getRecords: vi.fn(),
  getProfile: vi.fn(async () => ({})),
  getSegments: vi.fn(),
  getTracks: vi.fn(),
  getSegmentResults: vi.fn(),
  getRouteGroups: vi.fn(async () => [] as unknown[]),
  getPowerRecords: vi.fn(async () => [] as unknown[]),
}))

vi.mock('@/storage/authorData/snapshotClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/authorData/snapshotClient')>()
  return { ...actual, defaultSnapshotClient: mockSnapshotClient }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

beforeEach(async () => {
  await testDb.activities.clear()
  await testDb.settings.clear()
  localStorage.clear()
  useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * 生成测试活动（本地时区）。
 *
 * @param index 序号（用于生成唯一 ID/指纹）
 * @param startTime 开始时间（ISO 8601）
 * @param overrides 覆盖字段
 */
function makeActivity(
  index: number,
  startTime: string,
  overrides: Partial<Activity> = {},
): Activity {
  return {
    id: `act-${index}`,
    fileId: `file-${index}`,
    fileName: `ride-${index}.fit`,
    fingerprint: `fp-${index}`,
    activityType: 'cycling',
    startTime,
    endTime: startTime,
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000,
    elevationGain: 200,
    ...overrides,
  }
}

describe('表现趋势页面（规格 §39）', () => {
  it('周综述区块：展示本周与上周聚合对比', async () => {
    const repo = new DexieActivityRepository(testDb)
    // 动态周构造：以本周周一起点与上周同一天为基准，避免日期漂移
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const prevMonday = new Date(monday)
    prevMonday.setDate(monday.getDate() - 7)
    const weekStart = localDateKey(monday)
    const prevStart = localDateKey(prevMonday)
    await repo.addActivities([
      makeActivity(0, `${weekStart}T08:00:00`, { distance: 30000, duration: 3600, elevationGain: 200 }),
      makeActivity(1, `${prevStart}T08:00:00`, { distance: 15000, duration: 1800, elevationGain: 100 }),
    ])
    render(<PerformancePage />, { wrapper: MemoryRouter })

    const reviewSection = await screen.findByRole('region', { name: '每周训练综述' })
    // 本周卡片
    expect(within(reviewSection).getAllByText('30.00 km').length).toBeGreaterThan(0)
    // 上周对比：上一周距离 15.00 km
    expect(within(reviewSection).getAllByText('上周 15.00 km').length).toBeGreaterThan(0)
    // 较上周增减（本周 30km > 上周 15km → ↑ 100%）
    expect(within(reviewSection).getAllByText(/较上周↑/).length).toBeGreaterThan(0)
    // 趋势解读区块：最强周解读
    const insightsSection = await screen.findByRole('region', { name: '趋势解读' })
    expect(within(insightsSection).getByText(/最强的一周/)).toBeInTheDocument()
  })

  it('表现趋势区块：展示 12 周趋势图（无 FTP 时隐藏 TSS 提示）', async () => {
    const repo = new DexieActivityRepository(testDb)
    const now = new Date()
    await repo.addActivities([
      makeActivity(0, new Date(now.getTime() - 86400000).toISOString()),
    ])
    render(<PerformancePage />, { wrapper: MemoryRouter })

    // 周综述无 FTP 不影响展示（本/上周对比仍渲染）
    const trendSection = await screen.findByRole('region', { name: '表现趋势' })
    expect(await within(trendSection).findByText('近 12 周表现趋势')).toBeInTheDocument()
  })

  it('空数据时显示导入引导', async () => {
    render(<PerformancePage />, { wrapper: MemoryRouter })

    expect(await screen.findByText('暂无骑行数据，先导入 FIT 文件')).toBeInTheDocument()
  })

  it('训练配置含 FTP 时展示 TSS 提示', async () => {
    const repo = new DexieActivityRepository(testDb)
    const now = new Date()
    await repo.addActivities([makeActivity(0, now.toISOString())])
    // 写入本地训练配置（FTP）
    await saveSettings({ profile: { ftp: 250 } })
    useDataSourceStore.setState({ source: 'local' })
    render(<PerformancePage />, { wrapper: MemoryRouter })

    const trendSection = await screen.findByRole('region', { name: '表现趋势' })
    expect(await within(trendSection).findByText(/橙线：TSS/)).toBeInTheDocument()
    // 指标说明（UI-7）：折叠块含 EF/TSS 算法说明
    expect(within(trendSection).getByText('指标说明')).toBeInTheDocument()
    expect(
      within(trendSection).getByText(
        '= Σ(NP×时长) ÷ Σ(平均心率×时长)。同样心率下能输出的功率越高，有氧效率越好，长期上升是进步信号。',
      ),
    ).toBeInTheDocument()
  })
})

/**
 * 本地时区日期键（YYYY-MM-DD，两位补零）。
 *
 * @param date 日期
 */
function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}