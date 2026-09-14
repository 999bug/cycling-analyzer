/**
 * 赛段详情页测试。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：
 * 验证统计卡（距离/穿越次数/个人最好）、个人前三、成绩趋势图与历史成绩表；
 * 成绩已落库时不再触发全量扫描；不存在的赛段展示空态。
 */
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, CyclingDatabase } from '@/storage/db'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import SegmentDetailPage from '@/pages/SegmentDetailPage'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 作者快照客户端假实现（本页作者源分支读取） */
const mockSnapshotClient = vi.hoisted(() => ({
  getSegments: vi.fn(async () => [] as unknown[]),
  getSegmentResults: vi.fn(async () => ({}) as Record<string, unknown[]>),
}))

vi.mock('@/storage/authorData/snapshotClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/authorData/snapshotClient')>()
  return { ...actual, defaultSnapshotClient: mockSnapshotClient }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db as unknown as CyclingDatabase

beforeEach(async () => {
  await testDb.segments.clear()
  await testDb.segment_efforts.clear()
  await testDb.activities.clear()
  localStorage.clear()
  useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
})

/** 写入测试赛段并返回 id */
async function seedSegment(): Promise<number> {
  const repository = new DexieSegmentRepository(testDb)
  return repository.addSegment({
    name: '滨江爬坡',
    startLatitude: 31.2,
    startLongitude: 121.5,
    endLatitude: 31.3,
    endLongitude: 121.6,
    sourceActivityId: 'act-1',
    createdAt: '2026-08-01T08:00:00',
  })
}

/** 写入成绩（act-1 600s PR 带指标的，act-2 700s 慢 100s） */
async function seedEfforts(segmentId: number): Promise<void> {
  const repository = new DexieSegmentRepository(testDb)
  await repository.replaceSegmentEfforts(segmentId, [
    {
      activityId: 'act-1',
      startTime: '2026-08-02T08:00:00',
      durationSeconds: 600,
      avgSpeed: 6.0,
      avgPower: 240,
      avgHeartRate: 160,
    },
    {
      activityId: 'act-2',
      startTime: '2026-08-10T08:00:00',
      durationSeconds: 700,
    },
  ])
}

/** 以 /segments/:id 路由渲染详情页 */
function renderPage(id: number | string) {
  return render(
    <MemoryRouter initialEntries={[`/segments/${id}`]}>
      <Routes>
        <Route path="/segments/:id" element={<SegmentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('赛段详情页', () => {
  it('展示统计卡、个人前三与历史成绩表', async () => {
    const segmentId = await seedSegment()
    await seedEfforts(segmentId)
    renderPage(segmentId)

    expect(await screen.findByText('滨江爬坡')).toBeInTheDocument()
    // 统计卡：穿越次数与个人最好（600s，个人最好同时出现在前三/趋势/表格中）
    expect(screen.getByText('2 次')).toBeInTheDocument()
    expect(screen.getAllByText('00:10:00').length).toBeGreaterThan(0)
    // 历史成绩表：act-1 行带传感器指标，act-2 缺失指标显示 —
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3) // 表头 + 2 行
    // act-2 更近，排第一行数据行；缺失功率/心率 = —（缺失 ≠ 0）
    expect(within(rows[1]!).getByText('2026-08-10')).toBeInTheDocument()
    expect(within(rows[1]!).getAllByText('—')).toHaveLength(3)
    expect(within(rows[1]!).getByText('+100s')).toBeInTheDocument()
    // PR 行标「个人最好」
    expect(within(rows[2]!).getByText('个人最好')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('240 W')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('21.6 km/h')).toBeInTheDocument()
  })

  it('成绩已落库时不再触发全量扫描（effortsSyncedAt 不变化，直接读库）', async () => {
    const segmentId = await seedSegment()
    await seedEfforts(segmentId)
    const before = (await new DexieSegmentRepository(testDb).getSegment(segmentId))
      ?.effortsSyncedAt
    renderPage(segmentId)

    await screen.findByText('滨江爬坡')
    const after = (await new DexieSegmentRepository(testDb).getSegment(segmentId))
      ?.effortsSyncedAt
    expect(after).toBe(before)
    // 成绩未被重写
    expect(await testDb.segment_efforts.where('segmentId').equals(segmentId).count()).toBe(2)
  })

  it('不存在的赛段展示空态与返回链接', async () => {
    renderPage(9999)

    expect(await screen.findByText(/赛段不存在或已被删除/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回赛段列表' })).toHaveAttribute('href', '/segments')
  })

  it('作者源读快照赛段与预计算成绩榜', async () => {
    mockSnapshotClient.getSegments.mockResolvedValue([
      {
        id: 7,
        name: '温榆河绕圈',
        startLatitude: 40.0,
        startLongitude: 116.5,
        endLatitude: 40.1,
        endLongitude: 116.6,
        sourceActivityId: 'author-1',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ])
    mockSnapshotClient.getSegmentResults.mockResolvedValue({
      '7': [
        { activityId: 'author-1', startTime: '2026-08-01T08:00:00.000Z', durationSeconds: 600 },
        { activityId: 'author-2', startTime: '2026-08-02T08:00:00.000Z', durationSeconds: 700 },
      ],
    })
    useDataSourceStore.setState({ source: 'author', authorAvailable: true, authorName: 'Saul' })
    renderPage(7)

    expect(await screen.findByText('温榆河绕圈')).toBeInTheDocument()
    expect(screen.getByText('2 次')).toBeInTheDocument()
    // 榜单链接作者活动
    expect(screen.getByRole('link', { name: '2026-08-01' })).toHaveAttribute(
      'href',
      '/activities/author-1',
    )
  })
})
