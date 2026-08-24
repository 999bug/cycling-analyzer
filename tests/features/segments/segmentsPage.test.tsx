/**
 * 赛段页面测试（后续工作项：完整 Segment）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：
 * 断言空态引导、赛段卡片成绩榜（参与次数/最佳成绩/最快骑行链接）、删除赛段。
 */
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import type { Activity, ActivityRecord } from '@/types/activity'
import SegmentsPage from '@/pages/SegmentsPage'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 作者快照客户端假实现（无缓存，各用例独立配置；vi.hoisted 因 vi.mock 提升到文件顶部） */
const mockSnapshotClient = vi.hoisted(() => ({
  getManifest: vi.fn(),
  getActivities: vi.fn(),
  getRecords: vi.fn(),
  getProfile: vi.fn(),
  getSegments: vi.fn(async () => [] as unknown[]),
  getTracks: vi.fn(),
  getSegmentResults: vi.fn(async () => ({}) as Record<string, unknown[]>),
  getRouteGroups: vi.fn(),
  getPowerRecords: vi.fn(),
}))

// 页面经 defaultSnapshotClient 读快照：mock 为可控假实现（默认实现有模块级缓存会跨用例污染）
vi.mock('@/storage/authorData/snapshotClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/authorData/snapshotClient')>()
  return { ...actual, defaultSnapshotClient: mockSnapshotClient }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

beforeEach(async () => {
  // 清空表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
  await testDb.activity_records.clear()
  await testDb.segments.clear()
  // 数据源复位：默认有效源为本地
  localStorage.clear()
  useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * 生成测试活动（含轨迹逐点）。
 *
 * @param id 活动 ID
 * @param startTime 开始时间（ISO 8601）
 * @param records 逐点数据
 */
function makeActivity(id: string, startTime: string, records: ActivityRecord[]): Activity {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime,
    endTime: startTime,
    duration: 3600,
    elapsedTime: 3600,
    distance: 14000,
    elevationGain: 100,
    records,
  }
}

/** 穿越测试赛段的轨迹：t0 进起点圈，t1 进终点圈 */
function makeThroughRecords(startTs: number, endTs: number): ActivityRecord[] {
  return [
    { timestamp: 0, latitude: 31.19, longitude: 121.49 },
    { timestamp: startTs, latitude: 31.2001, longitude: 121.5001 },
    { timestamp: endTs, latitude: 31.3001, longitude: 121.6001 },
  ]
}

/** 写入测试赛段（起终点圆与 makeThroughRecords 匹配） */
async function seedSegment(name = '滨江线'): Promise<number> {
  const repository = new DexieSegmentRepository(testDb)
  return repository.addSegment({
    name,
    startLatitude: 31.2,
    startLongitude: 121.5,
    endLatitude: 31.3,
    endLongitude: 121.6,
    sourceActivityId: 'act-1',
    createdAt: '2026-08-17T08:00:00',
  })
}

describe('赛段页面', () => {
  it('无赛段时展示创建引导', async () => {
    render(<SegmentsPage />, { wrapper: MemoryRouter })

    expect(await screen.findByText(/还没有赛段/)).toBeInTheDocument()
    expect(screen.getByText(/设为赛段/)).toBeInTheDocument()
  })

  it('赛段卡片展示参与次数与最佳成绩，链接最快骑行', async () => {
    const activityRepository = new DexieActivityRepository(testDb)
    // act-1：800s 穿越；act-2：600s 穿越（最快）；act-3：不经过赛段
    await activityRepository.addActivities([
      makeActivity('act-1', '2026-08-01T08:00:00', makeThroughRecords(100, 900)),
      makeActivity('act-2', '2026-08-02T08:00:00', makeThroughRecords(100, 700)),
      makeActivity('act-3', '2026-08-03T08:00:00', [
        { timestamp: 0, latitude: 30.0, longitude: 120.0 },
      ]),
    ])
    await seedSegment()
    render(<SegmentsPage />, { wrapper: MemoryRouter })

    const card = (await screen.findByText('滨江线')).closest('.segment-card') as HTMLElement
    // 参与 2 次（act-3 未穿越）
    expect(within(card).getByText('2 次')).toBeInTheDocument()
    // 完整成绩排行按用时升序：#1 = act-2（600s），#2 = act-1（800s）
    const rows = within(card).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('1')).toBeInTheDocument()
    expect(within(rows[0]).getByText('2026-08-02')).toBeInTheDocument()
    expect(within(rows[0]).getByText('00:10:00').closest('a')).toHaveAttribute(
      'href',
      '/activities/act-2',
    )
    expect(within(rows[1]).getByText('2')).toBeInTheDocument()
    expect(within(rows[1]).getByText('2026-08-01')).toBeInTheDocument()
    expect(within(rows[1]).getByText('00:13:20').closest('a')).toHaveAttribute(
      'href',
      '/activities/act-1',
    )
  })

  it('删除赛段后卡片消失', async () => {
    await seedSegment('待删赛段')
    render(<SegmentsPage />, { wrapper: MemoryRouter })

    const card = (await screen.findByText('待删赛段')).closest('.segment-card') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: '删除赛段 待删赛段' }))

    expect(await screen.findByText(/还没有赛段/)).toBeInTheDocument()
  })

  it('作者模式展示快照赛段与预计算成绩榜，无删除按钮', async () => {
    mockSnapshotClient.getSegments.mockResolvedValue([
      {
        id: 1,
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
      '1': [
        { activityId: 'author-1', startTime: '2026-08-01T08:00:00.000Z', durationSeconds: 600 },
        { activityId: 'author-2', startTime: '2026-08-02T08:00:00.000Z', durationSeconds: 700 },
      ],
    })
    useDataSourceStore.setState({ source: 'author', authorAvailable: true, authorName: 'Saul' })
    render(<SegmentsPage />, { wrapper: MemoryRouter })

    const card = (await screen.findByText('温榆河绕圈')).closest('.segment-card') as HTMLElement
    expect(within(card).getByText('2 次')).toBeInTheDocument()
    // 快照成绩榜渲染完整排行，链接作者活动详情
    const rows = within(card).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('1')).toBeInTheDocument()
    expect(within(rows[0]).getByText('00:10:00').closest('a')).toHaveAttribute(
      'href',
      '/activities/author-1',
    )
    expect(within(rows[1]).getByText('2')).toBeInTheDocument()
    expect(within(rows[1]).getByText('00:11:40').closest('a')).toHaveAttribute(
      'href',
      '/activities/author-2',
    )
    // 只读：无删除按钮
    expect(within(card).queryByRole('button', { name: /删除赛段/ })).not.toBeInTheDocument()
  })

  it('作者模式快照缺赛段文件时显示空态（不报错）', async () => {
    mockSnapshotClient.getSegments.mockRejectedValue(new Error('HTTP 404'))
    mockSnapshotClient.getSegmentResults.mockRejectedValue(new Error('HTTP 404'))
    useDataSourceStore.setState({ source: 'author', authorAvailable: true, authorName: 'Saul' })
    render(<SegmentsPage />, { wrapper: MemoryRouter })

    expect(await screen.findByText('作者尚未创建赛段。')).toBeInTheDocument()
  })
})
