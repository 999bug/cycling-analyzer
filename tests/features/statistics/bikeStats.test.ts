/**
 * 自行车统计聚合测试（规格 §39 自行车统计）。
 *
 * 验证：按单车分组聚合、缺失单车名归未知组、空白字符串视为缺失、
 * 最近骑行时间取最大、次数降序与空输入边界。
 */
import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { buildBikeStats, UNKNOWN_BIKE_NAME } from '@/features/statistics/bikeStats'

/**
 * 生成活动摘要（仅自行车统计相关字段有效）。
 *
 * @param id 活动 ID
 * @param bikeName 单车名
 * @param overrides 覆盖字段
 */
function makeSummary(
  id: string,
  bikeName?: string,
  overrides: Partial<ActivitySummary> = {},
): ActivitySummary {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00.000Z',
    endTime: '2026-08-01T09:00:00.000Z',
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000,
    elevationGain: 200,
    bikeName,
    ...overrides,
  } as ActivitySummary
}

describe('buildBikeStats', () => {
  it('空输入返回空数组', () => {
    expect(buildBikeStats([])).toEqual([])
  })

  it('按单车分组聚合并按次数降序', () => {
    const entries = buildBikeStats([
      makeSummary('a', '公路车', { distance: 30000, duration: 3600, elevationGain: 200 }),
      makeSummary('b', '山地车', { distance: 20000, duration: 1800, elevationGain: 100 }),
      makeSummary('c', '公路车', {
        distance: 50000,
        duration: 5400,
        elevationGain: 500,
        startTime: '2026-08-05T08:00:00.000Z',
      }),
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      bikeName: '公路车',
      count: 2,
      totalDistance: 80000,
      totalDuration: 9000,
      totalElevationGain: 700,
      lastRideTime: '2026-08-05T08:00:00.000Z',
    })
    expect(entries[1].bikeName).toBe('山地车')
    expect(entries[1].count).toBe(1)
  })

  it('缺失单车名归未知自行车组', () => {
    const entries = buildBikeStats([
      makeSummary('a', '公路车'),
      makeSummary('b'),
      makeSummary('c'),
    ])

    // 未知自行车 2 次居首，公路车 1 次
    expect(entries.map((entry) => entry.bikeName)).toEqual([UNKNOWN_BIKE_NAME, '公路车'])
    expect(entries.find((entry) => entry.bikeName === UNKNOWN_BIKE_NAME)?.count).toBe(2)
  })

  it('空白字符串单车名视为缺失归未知组', () => {
    const entries = buildBikeStats([
      makeSummary('a', '   '),
      makeSummary('b', '公路车'),
    ])

    // 未知自行车与公路车各 1 次，按显示名升序「公路车」在前
    expect(entries.map((entry) => entry.bikeName)).toEqual(['公路车', UNKNOWN_BIKE_NAME])
  })

  it('次数相同按显示名升序（输出稳定）', () => {
    const entries = buildBikeStats([
      makeSummary('a', 'Zeta'),
      makeSummary('b', 'Alpha'),
    ])

    expect(entries.map((entry) => entry.bikeName)).toEqual(['Alpha', 'Zeta'])
  })
})