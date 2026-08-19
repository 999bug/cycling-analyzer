/**
 * 活动对比测试。
 *
 * compareActivities：两个活动摘要生成指标对比行（距离/时长/爬升/均速/均心率/均功率），
 * 每行含双方值与差值（后者 - 前者）；缺失字段值为 null 不伪造。
 */
import { describe, expect, it } from 'vitest'
import { compareActivities } from '@/features/activity/compare'
import type { Activity } from '@/types/activity'

/** 构造活动摘要 */
function makeActivity(overrides: Partial<Activity> & { id: string }): Activity {
  return {
    fileId: `file-${overrides.id}`,
    fileName: `${overrides.id}.fit`,
    fingerprint: `fp-${overrides.id}`,
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00.000Z',
    endTime: '2026-08-01T09:00:00.000Z',
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000,
    elevationGain: 200,
    records: [],
    ...overrides,
  }
}

describe('compareActivities 活动对比', () => {
  it('生成六项指标对比（双方值 + 差值 = 后者 - 前者）', () => {
    const a = makeActivity({ id: 'a', distance: 30000, duration: 3600, elevationGain: 200, avgSpeed: 8.33, avgHeartRate: 150, avgPower: 200 })
    const b = makeActivity({ id: 'b', distance: 35000, duration: 4000, elevationGain: 300, avgSpeed: 8.75, avgHeartRate: 160, avgPower: 220 })

    const rows = compareActivities(a, b)

    expect(rows.map((row) => row.label)).toEqual(['距离', '运动时长', '爬升', '平均速度', '平均心率', '平均功率'])
    // 距离：35000 - 30000 = 5000
    expect(rows[0]).toMatchObject({ a: 30000, b: 35000, diff: 5000 })
    // 时长：4000 - 3600 = 400
    expect(rows[1]).toMatchObject({ a: 3600, b: 4000, diff: 400 })
    // 爬升：+100
    expect(rows[2]).toMatchObject({ a: 200, b: 300, diff: 100 })
    // 均速：+0.42（浮点近似）
    expect(rows[3].diff).toBeCloseTo(0.42, 2)
    expect(rows[4].diff).toBe(10)
    expect(rows[5].diff).toBe(20)
  })

  it('缺失指标为 null（不伪造 0）', () => {
    const a = makeActivity({ id: 'a', distance: 30000, duration: 3600, elevationGain: 200 })
    const b = makeActivity({ id: 'b', distance: 35000, duration: 4000, elevationGain: 300 })

    const rows = compareActivities(a, b)

    expect(rows[3].a).toBeUndefined() // 均速缺失（领域约定：缺失 = undefined）
    expect(rows[4].b).toBeUndefined() // 心率缺失
    expect(rows[5].diff).toBeNull() // 功率双方缺失
  })

  it('同活动对比差值全为零', () => {
    const a = makeActivity({ id: 'a', distance: 30000, duration: 3600, elevationGain: 200, avgSpeed: 8.33 })

    const rows = compareActivities(a, a)

    for (const row of rows) {
      expect(row.diff === 0 || row.diff === null).toBe(true)
    }
  })
})
