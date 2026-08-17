/**
 * 年度回顾页面测试（后续工作项：年度回顾）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：写入跨年份数据后
 * 断言年份选择器、默认最新年份指标、切换年份后指标变化、月度图区块与空态引导。
 */
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import type { Activity } from '@/types/activity'
import YearReviewPage from '@/pages/YearReviewPage'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

beforeEach(async () => {
  // 清空表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
  await testDb.activity_records.clear()
  await testDb.settings.clear()
})

/**
 * 生成测试活动。
 *
 * @param index 序号（唯一 ID/指纹）
 * @param startTime 开始时间（ISO 8601）
 * @param distance 距离（米）
 */
function makeActivity(index: number, startTime: string, distance = 10000): Activity {
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
    distance,
    elevationGain: 100,
  }
}

describe('年度回顾页面', () => {
  it('默认展示最新年份指标，切换年份后指标变化', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivities([
      makeActivity(0, '2025-03-10T08:00:00', 20000),
      makeActivity(1, '2026-01-05T08:00:00', 30000),
      makeActivity(2, '2026-08-01T08:00:00', 50000),
    ])
    render(<YearReviewPage />, { wrapper: MemoryRouter })

    // 年份选择器：仅 2025/2026，默认选中 2026（最新）
    const group = await screen.findByRole('radiogroup', { name: '选择年份' })
    expect(within(group).getByRole('radio', { name: '2026 年' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: '2025 年' })).not.toBeChecked()

    // 2026 年两次骑行共 80 km
    expect(await screen.findByText('2 次')).toBeInTheDocument()
    expect(screen.getByText('80.00 km')).toBeInTheDocument()
    // 月度图区块存在
    expect(screen.getByRole('region', { name: '月度距离' })).toBeInTheDocument()

    // 切换 2025 年：一次骑行 20 km（总距离/平均单次/最长骑行三卡同值）
    await userEvent.click(within(group).getByRole('radio', { name: '2025 年' }))
    expect(await screen.findByText('1 次')).toBeInTheDocument()
    expect(screen.getAllByText('20.00 km')).toHaveLength(3)
  })

  it('无数据时展示导入引导文案', async () => {
    render(<YearReviewPage />, { wrapper: MemoryRouter })

    expect(await screen.findByText(/欢迎使用/)).toBeInTheDocument()
    expect(screen.getByText(/同步骑行数据/)).toBeInTheDocument()
  })

  it('加载失败时展示错误提示', async () => {
    vi.spyOn(DexieActivityRepository.prototype, 'listAllSummaries').mockRejectedValue(
      new Error('db down'),
    )
    render(<YearReviewPage />, { wrapper: MemoryRouter })

    expect(await screen.findByText(/加载失败/)).toBeInTheDocument()
  })
})
