/**
 * AuthorActivityRepository 与 DexieActivityRepository 行为对齐测试。
 *
 * 同一组摘要/逐点数据灌入两个实现，逐项断言读取接口结果一致
 * （作者快照是只读数据源，访客看到的查询行为必须与本地库一致）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import {
  DexieActivityRepository,
  queryActivityList,
  type ActivityListOptions,
  type ActivityReadRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'
import { AuthorActivityRepository } from '@/storage/authorData/authorActivityRepository'
import type { SnapshotClient } from '@/storage/authorData/snapshotClient'
import type { ActivityRecord } from '@/types/activity'

/** 测试摘要种子：覆盖月份/类型/功率缺失等分支 */
const SEED_SUMMARIES: ActivitySummary[] = [
  makeSummary({ id: 'a1', startTime: '2026-08-10T01:00:00.000Z', distance: 50000, avgPower: 200, name: '晨骑' }),
  makeSummary({ id: 'a2', startTime: '2026-08-05T01:00:00.000Z', distance: 80000, activityType: 'cycling' }),
  makeSummary({ id: 'a3', startTime: '2026-07-20T01:00:00.000Z', distance: 30000, activityType: 'running' }),
]

/** 测试逐点数据 */
const SEED_RECORDS: Record<string, ActivityRecord[]> = {
  a1: [{ timestamp: 100 }, { timestamp: 200 }, { timestamp: 300 }],
  a2: [{ timestamp: 100 }],
  a3: [],
}

/**
 * 生成测试摘要（自动补全必填字段）。
 *
 * @param overrides 覆盖字段
 */
function makeSummary(overrides: Partial<ActivitySummary> & { id: string }): ActivitySummary {
  return {
    fileId: overrides.id,
    fileName: `${overrides.id}.fit`,
    fingerprint: `fp-${overrides.id}`,
    activityType: 'cycling',
    startTime: '2026-08-01T00:00:00.000Z',
    endTime: '2026-08-01T02:00:00.000Z',
    duration: 7200,
    elapsedTime: 7300,
    distance: 60000,
    elevationGain: 500,
    ...overrides,
  }
}

/**
 * 构造内存快照假客户端。
 */
function makeFakeClient(): SnapshotClient {
  return {
    getManifest: async () => ({ snapshotVersion: 1, author: 'Saul', generatedAt: '', activityCount: 3 }),
    getActivities: async () => SEED_SUMMARIES,
    getRecords: async (id) => SEED_RECORDS[id] ?? [],
    getProfile: async () => ({}),
    getSegments: async () => [],
    getTracks: async () => ({ toleranceMeters: 10, tracks: [] }),
    getSegmentResults: async () => ({}),
    getRouteGroups: async () => [],
    getPowerRecords: async () => [],
    getRouteTracks: async () => ({ toleranceMeters: 10, routes: [] }),
  }
}

describe('AuthorActivityRepository 与 DexieActivityRepository 行为对齐', () => {
  let db: CyclingDatabase
  let dexie: ActivityReadRepository
  const author: ActivityReadRepository = new AuthorActivityRepository(makeFakeClient())

  beforeEach(async () => {
    db = new CyclingDatabase()
    dexie = new DexieActivityRepository(db)
    await db.activities.bulkAdd(SEED_SUMMARIES)
    await db.activity_records.bulkAdd(
      Object.entries(SEED_RECORDS).flatMap(([activityId, records]) =>
        records.map((record) => ({ ...record, activityId })),
      ),
    )
  })

  afterEach(async () => {
    await db.delete()
  })

  /** 两实现对同一查询应返回相同结果（items 逐项相等、total 一致） */
  async function expectSameList(options?: ActivityListOptions): Promise<void> {
    const expected = await dexie.listActivities(options)
    const actual = await author.listActivities(options)
    expect(actual).toEqual(expected)
  }

  it('listActivities 各查询组合行为一致', async () => {
    await expectSameList()
    await expectSameList({ sortBy: 'distance', sortOrder: 'asc' })
    await expectSameList({ month: '2026-08' })
    await expectSameList({ month: '2026-07', activityType: 'running' })
    await expectSameList({ search: '晨骑' })
    await expectSameList({ search: 'A2.fit' })
    await expectSameList({ minDistance: 40000, maxDistance: 70000 })
    await expectSameList({ minAvgPower: 100 })
    await expectSameList({ limit: 2, offset: 1 })
    await expectSameList({ limit: 0 })
  })

  it('getById 命中与未命中一致', async () => {
    expect(await author.getById('a1')).toEqual(await dexie.getById('a1'))
    expect(await author.getById('missing')).toEqual(await dexie.getById('missing'))
  })

  it('getRecords 全量与分页一致', async () => {
    // Dexie 返回实体带自增 id 与 activityId 关联字段（ActivityRecord 超集），剥离后比对领域字段
    const strip = (list: ActivityRecord[]): ActivityRecord[] =>
      list.map((record) => {
        const entity = record as ActivityRecord & { id?: number; activityId?: string }
        const { id: _id, activityId: _activityId, ...fields } = entity
        void _id
        void _activityId
        return fields
      })
    expect(await author.getRecords('a1')).toEqual(strip(await dexie.getRecords('a1')))
    expect(await author.getRecords('a1', { offset: 1, limit: 1 })).toEqual(
      strip(await dexie.getRecords('a1', { offset: 1, limit: 1 })),
    )
    expect(await author.getRecords('a3')).toEqual([])
  })

  it('countActivities 一致', async () => {
    expect(await author.countActivities()).toBe(await dexie.countActivities())
  })

  it('summarizeByRange 含边界一致', async () => {
    const start = '2026-08-01T00:00:00.000Z'
    const end = '2026-08-10T01:00:00.000Z'
    expect(await author.summarizeByRange(start, end)).toEqual(await dexie.summarizeByRange(start, end))
  })

  it('listAllSummaries 均按开始时间降序', async () => {
    const expected = await dexie.listAllSummaries()
    const actual = await author.listAllSummaries()
    expect(actual.map((a) => a.id)).toEqual(expected.map((a) => a.id))
    expect(actual.map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('existsByFingerprint 恒为 false（指纹去重只查本地库）', async () => {
    expect(await author.existsByFingerprint('fp-a1')).toBe(false)
    expect(await dexie.existsByFingerprint('fp-a1')).toBe(true)
  })
})

describe('queryActivityList 纯函数', () => {
  it('空输入返回空分页', () => {
    expect(queryActivityList([])).toEqual({ items: [], total: 0 })
  })
})
