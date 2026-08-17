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
