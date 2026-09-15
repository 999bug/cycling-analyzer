/**
 * 赛段仓库测试（后续工作项：完整 Segment）。
 *
 * fake-indexeddb + 真 Dexie 实例：验证新增/列表/删除往返与 v2 表结构。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'

/** 每用例独立数据库实例（库名隔离） */
let testDb: CyclingDatabase
let repository: DexieSegmentRepository

beforeEach(async () => {
  testDb = new CyclingDatabase(`segments-test-${crypto.randomUUID()}`)
  repository = new DexieSegmentRepository(testDb)
})

/** 构造赛段字段（不含 id） */
function makeSegment(name: string) {
  return {
    name,
    startLatitude: 31.2,
    startLongitude: 121.5,
    endLatitude: 31.3,
    endLongitude: 121.6,
    sourceActivityId: 'act-1',
    createdAt: '2026-08-17T08:00:00',
  }
}

describe('DexieSegmentRepository', () => {
  it('新增后可列出（自增 id 回填）', async () => {
    const id = await repository.addSegment(makeSegment('滨江爬坡'))
    expect(id).toBeGreaterThan(0)

    const all = await repository.listSegments()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id, name: '滨江爬坡', sourceActivityId: 'act-1' })
  })

  it('删除后不再列出', async () => {
    const id = await repository.addSegment(makeSegment('环线'))
    await repository.deleteSegment(id)

    expect(await repository.listSegments()).toEqual([])
  })

  it('多条按创建顺序返回', async () => {
    await repository.addSegment(makeSegment('A'))
    await repository.addSegment(makeSegment('B'))

    const names = (await repository.listSegments()).map((segment) => segment.name)
    expect(names).toEqual(['A', 'B'])
  })
})

/** 构造成绩字段（不含 id/createdAt/segmentId/activityId） */
function makeEffort(durationSeconds: number) {
  return {
    startTime: '2026-08-01T08:00:00',
    durationSeconds,
    avgSpeed: 5.5,
    avgPower: 220,
    avgHeartRate: 155,
  }
}

describe('DexieSegmentRepository 成绩落库（v6）', () => {
  it('replaceSegmentEfforts 整体替换并按用时升序读出，附带打同步标记', async () => {
    const id = await repository.addSegment(makeSegment('滨江爬坡'))
    await repository.replaceSegmentEfforts(id, [
      { activityId: 'act-slow', ...makeEffort(800) },
      { activityId: 'act-fast', ...makeEffort(600) },
    ])

    const efforts = await repository.listEffortsBySegment(id)
    expect(efforts.map((e) => e.activityId)).toEqual(['act-fast', 'act-slow'])
    expect(efforts[0]).toMatchObject({ durationSeconds: 600, avgPower: 220 })

    const segment = await repository.getSegment(id)
    expect(segment?.effortsSyncedAt).toBeTruthy()
  })

  it('再次 replace 清除旧成绩（幂等，不残留孤儿行）', async () => {
    const id = await repository.addSegment(makeSegment('滨江爬坡'))
    await repository.replaceSegmentEfforts(id, [{ activityId: 'act-1', ...makeEffort(600) }])
    await repository.replaceSegmentEfforts(id, [{ activityId: 'act-2', ...makeEffort(700) }])

    const efforts = await repository.listEffortsBySegment(id)
    expect(efforts).toHaveLength(1)
    expect(efforts[0]?.activityId).toBe('act-2')
  })

  it('upsertActivityEffort 新增后更新同键成绩（[segmentId+activityId] 唯一）', async () => {
    const id = await repository.addSegment(makeSegment('滨江爬坡'))
    await repository.upsertActivityEffort(id, 'act-1', makeEffort(700))
    await repository.upsertActivityEffort(id, 'act-1', makeEffort(650))

    const efforts = await repository.listEffortsBySegment(id)
    expect(efforts).toHaveLength(1)
    expect(efforts[0]).toMatchObject({ activityId: 'act-1', durationSeconds: 650 })
  })

  it('upsertActivityEffort 传 null 删除该活动成绩', async () => {
    const id = await repository.addSegment(makeSegment('滨江爬坡'))
    await repository.upsertActivityEffort(id, 'act-1', makeEffort(700))
    await repository.upsertActivityEffort(id, 'act-1', null)

    expect(await repository.listEffortsBySegment(id)).toEqual([])
  })

  it('deleteSegment 级联删除该赛段全部成绩', async () => {
    const id = await repository.addSegment(makeSegment('滨江爬坡'))
    await repository.replaceSegmentEfforts(id, [
      { activityId: 'act-1', ...makeEffort(600) },
      { activityId: 'act-2', ...makeEffort(700) },
    ])
    await repository.deleteSegment(id)

    expect(await testDb.segment_efforts.toArray()).toEqual([])
  })

  it('listEffortsBySegments 一次取多个赛段成绩并各自按用时升序', async () => {
    const idA = await repository.addSegment(makeSegment('A'))
    const idB = await repository.addSegment(makeSegment('B'))
    await repository.replaceSegmentEfforts(idA, [
      { activityId: 'act-slow', ...makeEffort(800) },
      { activityId: 'act-fast', ...makeEffort(600) },
    ])
    await repository.replaceSegmentEfforts(idB, [{ activityId: 'act-1', ...makeEffort(700) }])

    const grouped = await repository.listEffortsBySegments([idA, idB])
    expect(grouped.get(idA)?.map((e) => e.activityId)).toEqual(['act-fast', 'act-slow'])
    expect(grouped.get(idB)?.map((e) => e.activityId)).toEqual(['act-1'])
  })

  it('mergeEffortsForActivities 只替换指定活动的成绩，其余保留', async () => {
    const id = await repository.addSegment(makeSegment('滨江爬坡'))
    await repository.replaceSegmentEfforts(id, [
      { activityId: 'act-1', ...makeEffort(600) },
      { activityId: 'act-2', ...makeEffort(700) },
    ])

    // 只重扫 act-2（纠偏/重新导入）：act-1 的旧成绩继续保留
    await repository.mergeEffortsForActivities(
      id,
      ['act-2'],
      [{ activityId: 'act-2', ...makeEffort(650) }],
    )

    const efforts = await repository.listEffortsBySegment(id)
    expect(efforts.map((e) => e.activityId)).toEqual(['act-1', 'act-2'])
    expect(efforts.find((e) => e.activityId === 'act-2')?.durationSeconds).toBe(650)

    const segment = await repository.getSegment(id)
    expect(segment?.effortsSyncedAt).toBeTruthy()
  })

  it('mergeEffortsForActivities 传入空成绩即删除这些活动的旧成绩', async () => {
    const id = await repository.addSegment(makeSegment('滨江爬坡'))
    await repository.replaceSegmentEfforts(id, [
      { activityId: 'act-1', ...makeEffort(600) },
      { activityId: 'act-2', ...makeEffort(700) },
    ])

    // 重扫后 act-2 不再穿越该赛段：成绩移除，act-1 不受影响
    await repository.mergeEffortsForActivities(id, ['act-2'], [])

    const efforts = await repository.listEffortsBySegment(id)
    expect(efforts.map((e) => e.activityId)).toEqual(['act-1'])
  })

  it('deleteEffortsByActivity 按活动清理（跨赛段）', async () => {
    const idA = await repository.addSegment(makeSegment('A'))
    const idB = await repository.addSegment(makeSegment('B'))
    await repository.upsertActivityEffort(idA, 'act-1', makeEffort(600))
    await repository.upsertActivityEffort(idB, 'act-1', makeEffort(610))
    await repository.upsertActivityEffort(idB, 'act-2', makeEffort(620))

    await repository.deleteEffortsByActivity('act-1')

    expect(await repository.listEffortsBySegment(idA)).toEqual([])
    const left = await repository.listEffortsBySegment(idB)
    expect(left.map((e) => e.activityId)).toEqual(['act-2'])
  })
})
