/**
 * localDate 回填测试（v8 索引字段）：补齐缺失字段、落就绪标志、幂等、非法时间不阻塞。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActivityEntity, CyclingDatabase } from '@/storage/db'
import { CyclingDatabase as CyclingDatabaseCtor } from '@/storage/db'
import {
  backfillLocalDates,
  isLocalDateIndexReady,
  LOCAL_DATE_READY_KEY,
} from '@/storage/localDateBackfill'
import { localDateKeyFromIso } from '@/utils/format'

describe('backfillLocalDates', () => {
  let db: CyclingDatabase

  beforeEach(() => {
    db = new CyclingDatabaseCtor()
  })

  afterEach(async () => {
    await db.delete()
  })

  /**
   * 直接写入存量行（模拟 v8 之前的数据：没有 localDate 字段）。
   *
   * @param rows 活动 id 与开始时间
   */
  async function seedLegacyRows(rows: { id: string; startTime: string }[]): Promise<void> {
    await db.activities.bulkAdd(
      rows.map(
        (row): ActivityEntity => ({
          id: row.id,
          fileId: `file-${row.id}`,
          fileName: `${row.id}.fit`,
          fingerprint: `fp-${row.id}`,
          activityType: 'cycling',
          startTime: row.startTime,
          endTime: row.startTime,
          duration: 3600,
          elapsedTime: 3600,
          distance: 20000,
        }),
      ),
    )
  }

  it('补齐缺失的 localDate 并落就绪标志', async () => {
    await seedLegacyRows([
      { id: 'a1', startTime: '2026-08-17T08:00:00.000Z' },
      { id: 'a2', startTime: '2025-03-02T08:00:00.000Z' },
    ])
    expect(await isLocalDateIndexReady(db)).toBe(false)

    const filled = await backfillLocalDates(db)

    expect(filled).toBe(2)
    expect(await isLocalDateIndexReady(db)).toBe(true)
    expect((await db.activities.get('a1'))?.localDate).toBe(
      localDateKeyFromIso('2026-08-17T08:00:00.000Z'),
    )
    expect((await db.activities.get('a2'))?.localDate).toBe(
      localDateKeyFromIso('2025-03-02T08:00:00.000Z'),
    )
  })

  it('只补该字段，其余摘要字段不动', async () => {
    await seedLegacyRows([{ id: 'a1', startTime: '2026-08-17T08:00:00.000Z' }])

    await backfillLocalDates(db)

    const row = await db.activities.get('a1')
    expect(row).toMatchObject({
      fileName: 'a1.fit',
      distance: 20000,
      duration: 3600,
      activityType: 'cycling',
    })
  })

  it('已就绪时再次调用不做任何事（幂等）', async () => {
    await seedLegacyRows([{ id: 'a1', startTime: '2026-08-17T08:00:00.000Z' }])
    await backfillLocalDates(db)

    // 抹掉字段再调用：已就绪则不应重写
    await db.activities.update('a1', { localDate: undefined })
    const filled = await backfillLocalDates(db)

    expect(filled).toBe(0)
    expect((await db.activities.get('a1'))?.localDate).toBeUndefined()
  })

  it('startTime 非法的存量行不让回填卡死，仍标记就绪（该行本就不该被年/月筛选命中）', async () => {
    await seedLegacyRows([
      { id: 'a1', startTime: 'not-a-date' },
      { id: 'a2', startTime: '2026-08-17T08:00:00.000Z' },
    ])

    const filled = await backfillLocalDates(db)

    expect(filled).toBe(1)
    expect(await isLocalDateIndexReady(db)).toBe(true)
    expect((await db.activities.get('a1'))?.localDate).toBeUndefined()
    expect((await db.activities.get('a2'))?.localDate).toBeDefined()
  })

  it('空库直接标记就绪（新用户无需回填）', async () => {
    const filled = await backfillLocalDates(db)

    expect(filled).toBe(0)
    const entry = await db.settings.get(LOCAL_DATE_READY_KEY)
    expect(entry?.value).toBe(true)
  })
})
