/**
 * 历史活动 NP 回填测试（规格 §39 P2）。
 *
 * 验证：仅「有平均功率但 NP 缺失」的活动被回填（逐点重算），
 * 已有 NP / 无功率 / 时长不足 NP 窗口的活动跳过，回填幂等。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Activity, ActivityRecord } from '@/types/activity'
import { CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { backfillNormalizedPower } from '@/features/analysis/backfillNormalizedPower'

/** 测试数据库实例 */
let db: CyclingDatabase

/** 活动仓库 */
let repo: DexieActivityRepository

beforeEach(() => {
  db = new CyclingDatabase()
  repo = new DexieActivityRepository(db)
})

afterEach(async () => {
  await db.delete()
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
    startTime: '2026-08-10T08:00:00.000Z',
    endTime: '2026-08-10T09:00:00.000Z',
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000,
    elevationGain: 200,
    ...overrides,
  }
}

/**
 * 生成等间隔功率逐点（60 点 1s 采样，满足 NP 30s 窗口）。
 *
 * @param power 恒定功率（W）
 */
function makePowerRecords(power: number): ActivityRecord[] {
  return Array.from({ length: 60 }, (_, index) => ({
    timestamp: 1_786_000_000 + index,
    power,
  }))
}

describe('backfillNormalizedPower', () => {
  it('回填有平均功率但 NP 缺失的活动（逐点重算）', async () => {
    await repo.addActivity(
      makeActivity('a', { avgPower: 145, records: makePowerRecords(150) }),
    )

    const updated = await backfillNormalizedPower(repo)

    expect(updated).toBe(1)
    // 恒定功率的 NP 等于该功率
    expect((await repo.getById('a'))?.normalizedPower).toBeCloseTo(150, 6)
  })

  it('已有 NP / 无功率 / 时长不足窗口的活动跳过', async () => {
    await repo.addActivities([
      makeActivity('has-np', { avgPower: 180, normalizedPower: 200, records: makePowerRecords(150) }),
      makeActivity('no-power', {}),
      makeActivity('too-short', { avgPower: 150, duration: 20, records: makePowerRecords(150) }),
    ])

    const updated = await backfillNormalizedPower(repo)

    expect(updated).toBe(0)
    // 已有 NP 不被覆盖
    expect((await repo.getById('has-np'))?.normalizedPower).toBe(200)
    expect((await repo.getById('no-power'))?.normalizedPower).toBeUndefined()
    expect((await repo.getById('too-short'))?.normalizedPower).toBeUndefined()
  })

  it('逐点无法算出 NP（全缺功率）时不落库且不重复处理', async () => {
    await repo.addActivity(
      makeActivity('a', { avgPower: 145, records: [{ timestamp: 1 }, { timestamp: 31 }] }),
    )

    expect(await backfillNormalizedPower(repo)).toBe(0)
    expect((await repo.getById('a'))?.normalizedPower).toBeUndefined()
  })

  it('幂等：第二次调用无新增回填', async () => {
    await repo.addActivity(
      makeActivity('a', { avgPower: 145, records: makePowerRecords(150) }),
    )

    expect(await backfillNormalizedPower(repo)).toBe(1)
    expect(await backfillNormalizedPower(repo)).toBe(0)
  })
})
