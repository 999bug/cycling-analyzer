/**
 * 训练状态区块测试（规格 §39 P2）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb，验证三种状态：
 * 无 FTP 引导、无功率数据提示、就绪（卡片 + 趋势图），以及历史活动
 * NP 缺失时先回填再计算的链路。
 */
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { saveSettings } from '@/features/settings/settings'
import type { Activity } from '@/types/activity'
import TrainingStatusSection from '@/features/dashboard/TrainingStatusSection'

// 组件使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，组件与测试共享） */
const testDb = db

beforeEach(async () => {
  // 清空相关表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
  await testDb.activity_records.clear()
  await testDb.settings.clear()
})

/**
 * 生成测试活动。
 *
 * @param id 活动 ID
 * @param overrides 覆盖字段
 */
function makeActivity(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000,
    elevationGain: 200,
    ...overrides,
  }
}

describe('TrainingStatusSection', () => {
  it('未配置 FTP 时显示设置引导（不伪造计算）', async () => {
    render(<TrainingStatusSection />)

    expect(await screen.findByText(/配置 FTP 后可查看训练状态/)).toBeInTheDocument()
  })

  it('有 FTP 但无功率数据时显示导入提示', async () => {
    await saveSettings({ profile: { ftp: 200 } })
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makeActivity('a'))

    render(<TrainingStatusSection />)

    expect(await screen.findByText(/暂无功率数据/)).toBeInTheDocument()
  })

  it('有 FTP 且活动含 NP 时显示当前值卡片与趋势图', async () => {
    await saveSettings({ profile: { ftp: 200 } })
    const repo = new DexieActivityRepository(testDb)
    // IF = 200/200 = 1，1 小时 TSS = 100
    await repo.addActivity(makeActivity('a', { normalizedPower: 200 }))

    render(<TrainingStatusSection />)

    // 卡片标签
    expect(await screen.findByText('体能（CTL）')).toBeInTheDocument()
    expect(screen.getByText('疲劳（ATL）')).toBeInTheDocument()
    expect(screen.getByText('状态（TSB）')).toBeInTheDocument()
    // 首日 CTL = 100/42 ≈ 2，ATL = 100/7 ≈ 14
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    // 趋势图与图例
    expect(screen.getByRole('img', { name: '训练负荷趋势图' })).toBeInTheDocument()
    expect(screen.getByText('— 体能（CTL）')).toBeInTheDocument()
  })

  it('历史活动 NP 缺失时先回填再计算（有平均功率 + 功率逐点）', async () => {
    await saveSettings({ profile: { ftp: 150 } })
    const repo = new DexieActivityRepository(testDb)
    // 60 点 1s 采样恒定 150W：无 NP 但有 avgPower，触发回填链路
    await repo.addActivity(
      makeActivity('legacy', {
        avgPower: 145,
        records: Array.from({ length: 60 }, (_, index) => ({
          timestamp: Math.floor(Date.now() / 1000) - 60 + index,
          power: 150,
        })),
      }),
    )

    render(<TrainingStatusSection />)

    // 回填后 IF = 150/150 = 1 → 正常显示卡片
    expect(await screen.findByText('体能（CTL）')).toBeInTheDocument()
    // NP 已回填落库
    expect((await repo.getById('legacy'))?.normalizedPower).toBeCloseTo(150, 6)
  })
})
