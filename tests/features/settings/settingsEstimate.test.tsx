/**
 * 设置页 FTP/VO2Max 估算集成测试（规格 §39）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：
 * 近 90 天含功率活动 → 显示估算值与「采用」按钮；无功率数据/超窗活动 →
 * 引导文案（不伪造）；点击「采用」保存 FTP 并回填输入框。
 */
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import SettingsPage from '@/pages/SettingsPage'
import { getSettings, saveSettings } from '@/features/settings/settings'
import type { Activity, ActivityRecord } from '@/types/activity'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

/** 无功率数据引导文案 */
const NO_POWER_GUIDE = /近 90 天没有功率数据/

beforeEach(async () => {
  // 清空各表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
  await testDb.activity_records.clear()
  await testDb.files.clear()
  await testDb.settings.clear()
})

/**
 * 构造恒定功率的测试活动（5 秒采样，跨度 1300 秒，覆盖 20 分钟窗口）。
 *
 * @param id 活动 ID
 * @param startTime 开始时间（ISO 8601）
 * @param power 恒定功率（W）
 * @returns 活动（含逐点记录）
 */
function makePoweredActivity(id: string, startTime: string, power: number): Activity {
  // 261 点 × 5 秒 = 1300 秒跨度，满足 20 分钟（1200s）窗口
  const records: ActivityRecord[] = Array.from({ length: 261 }, (_, index) => ({
    timestamp: index * 5,
    power,
  }))
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime,
    endTime: startTime,
    duration: 1300,
    elapsedTime: 1300,
    distance: 10000,
    elevationGain: 50,
    avgPower: power,
    records,
  }
}

describe('设置页 FTP/VO2Max 估算', () => {
  const user = userEvent.setup()

  it('无活动时显示无功率数据引导文案', async () => {
    render(<SettingsPage />)

    expect(await screen.findByText(NO_POWER_GUIDE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '采用' })).not.toBeInTheDocument()
  })

  it('近 90 天含功率活动显示估算 FTP；未保存体重时显示 VO2Max 引导', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makePoweredActivity('act-1', new Date().toISOString(), 200))
    render(<SettingsPage />)

    // 200 W × 0.95 = 190 W
    expect(await screen.findByText(/估算 FTP：190 W/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '采用' })).toBeInTheDocument()
    expect(screen.getByText('填写并保存体重后可估算 VO2Max')).toBeInTheDocument()
  })

  it('已保存体重时显示估算 VO2Max', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makePoweredActivity('act-1', new Date().toISOString(), 200))
    await saveSettings({ profile: { weightKg: 70 } })
    render(<SettingsPage />)

    // 10.8 × 200 / 70 + 7 ≈ 37.9
    expect(await screen.findByText(/估算 VO2Max：37\.9 ml\/kg\/min/)).toBeInTheDocument()
  })

  it('点击「采用」保存估算 FTP 并回填输入框', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makePoweredActivity('act-1', new Date().toISOString(), 200))
    render(<SettingsPage />)

    await user.click(await screen.findByRole('button', { name: '采用' }))

    expect(await screen.findByText('已采用估算 FTP：190 W')).toBeInTheDocument()
    expect(screen.getByLabelText('FTP')).toHaveValue(190)
    const settings = await getSettings()
    expect(settings.profile.ftp).toBe(190)
  })

  it('超过 90 天的活动不参与估算', async () => {
    const repo = new DexieActivityRepository(testDb)
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    await repo.addActivity(makePoweredActivity('act-old', old, 200))
    render(<SettingsPage />)

    expect(await screen.findByText(NO_POWER_GUIDE)).toBeInTheDocument()
    // 引导文案含「估算 FTP」字样，断言带数值的估算结果不存在
    expect(screen.queryByText(/估算 FTP：\d/)).not.toBeInTheDocument()
  })
})
