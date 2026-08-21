/**
 * 训练状态区块测试（规格 §39 P2）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb，验证三种状态：
 * 无 FTP 引导、无功率数据提示、就绪（卡片 + 趋势图），以及历史活动
 * NP 缺失时先回填再计算的链路。
 */
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { saveSettings } from '@/features/settings/settings'
import { useDataSourceStore } from '@/stores/dataSourceStore'
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
  // 数据源复位：默认有效源为本地
  localStorage.clear()
  useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
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
    expect(await screen.findAllByText('体能（CTL）')).not.toHaveLength(0)
    expect(screen.getAllByText('疲劳（ATL）').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('状态（TSB）').length).toBeGreaterThanOrEqual(1)
    // 首日 CTL = 100/42 ≈ 2，ATL = 100/7 ≈ 14
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    // 趋势图与图例
    expect(screen.getByRole('img', { name: '训练负荷趋势图' })).toBeInTheDocument()
    expect(screen.getByText('— 体能（CTL）')).toBeInTheDocument()
    // 指标说明（UI-7）：折叠块含怎么算/怎么理解
    expect(screen.getByText('指标说明')).toBeInTheDocument()
    expect(screen.getByText('每日 TSS 的 42 天指数加权平均，反映长期训练积累，稳步上升说明有氧基础在增强。')).toBeInTheDocument()
    expect(screen.getByText('= CTL − ATL。正值代表休息充足、状态新鲜；负值代表近期负荷大、身体疲劳，适度负值属正常训练反应。')).toBeInTheDocument()
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
    expect(await screen.findAllByText('体能（CTL）')).not.toHaveLength(0)
    // NP 已回填落库
    expect((await repo.getById('legacy'))?.normalizedPower).toBeCloseTo(150, 6)
  })

  it('作者模式用快照 profile 的 FTP（访客无需配置），且不回填本地库', async () => {
    // 本地库遗留一条无 NP 活动：author 模式不回填（写操作仅本地源）
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makeActivity('legacy', { avgPower: 145 }))

    // 快照：一条含 NP 的活动 + 作者 FTP 200
    const authorSummary: Record<string, unknown> = {
      ...makeActivity('author-1', { normalizedPower: 200 }),
    }
    delete authorSummary.records
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('author-data/activities.json')) {
          return new Response(JSON.stringify([authorSummary]), { status: 200 })
        }
        if (url.includes('author-data/profile.json')) {
          return new Response(JSON.stringify({ ftp: 200 }), { status: 200 })
        }
        return new Response('not found', { status: 404 })
      }),
    )
    useDataSourceStore.setState({ source: 'author', authorAvailable: true, authorName: 'Saul' })

    render(<TrainingStatusSection />)

    // IF = 200/200 = 1 → 显示卡片（FTP 来自快照而非本地设置）
    expect(await screen.findAllByText('体能（CTL）')).not.toHaveLength(0)
    // 本地库活动未被回填
    expect((await repo.getById('legacy'))?.normalizedPower).toBeUndefined()
  })
})
