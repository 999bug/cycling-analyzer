/**
 * 周度训练聚合测试（规格 §39 表现趋势 / 每周训练综述）。
 *
 * 验证：按周分组聚合、连续周序列含空周、EF 按时长加权、
 * EF/TSS 数据缺失时为 undefined、TSS 需要 FTP、周起点为本地周一、
 * 每周综述返回目标周与上一周。
 */
import { describe, expect, it } from 'vitest'
import {
  buildWeekReview,
  buildWeeklySeries,
  weekStartKey,
  type WeekActivity,
} from '@/features/analysis/weeklyStats'

/**
 * 构造周聚合参与活动。
 *
 * @param startTime 开始时间（ISO 8601）
 * @param overrides 覆盖字段
 */
function makeActivity(
  startTime: string,
  overrides: Partial<WeekActivity> = {},
): WeekActivity {
  return {
    startTime,
    duration: 3600,
    distance: 30000,
    elevationGain: 200,
    ...overrides,
  }
}

describe('weekStartKey', () => {
  it('周一返回自身，周日回退 6 天', () => {
    // 2026-08-17 是周一（验证：2026-08-17 实际为周一）
    expect(weekStartKey(new Date(2026, 7, 17))).toBe('2026-08-17')
    expect(weekStartKey(new Date(2026, 7, 23))).toBe('2026-08-17')
  })
})

describe('buildWeeklySeries', () => {
  it('按周分组聚合并按周起点升序（含空周）', () => {
    const activities = [
      makeActivity('2026-08-17T08:00:00.000Z'), // 周一
      makeActivity('2026-08-19T08:00:00.000Z', { duration: 1800, distance: 15000 }),
      makeActivity('2026-08-10T08:00:00.000Z'), // 上一周
    ]
    const series = buildWeeklySeries(activities, 3, undefined, new Date(2026, 7, 21))

    expect(series).toHaveLength(3)
    expect(series[0].weekStart).toBe('2026-08-03')
    expect(series[0].rides).toBe(0)
    expect(series[1].weekStart).toBe('2026-08-10')
    expect(series[1]).toMatchObject({ rides: 1, distance: 30000, duration: 3600, elevationGain: 200 })
    expect(series[2].weekStart).toBe('2026-08-17')
    expect(series[2]).toMatchObject({ rides: 2, distance: 45000, duration: 5400, elevationGain: 400 })
  })

  it('效率因子按骑行时长加权（ΣNP×时长 / Σ心率×时长）', () => {
    const activities = [
      // 300W / 150bpm，3600s
      makeActivity('2026-08-17T08:00:00.000Z', { normalizedPower: 300, avgHeartRate: 150 }),
      // 200W / 100bpm，1800s
      makeActivity('2026-08-19T08:00:00.000Z', {
        duration: 1800,
        normalizedPower: 200,
        avgHeartRate: 100,
      }),
    ]
    const series = buildWeeklySeries(activities, 1, undefined, new Date(2026, 7, 21))

    const ef =
      (300 * 3600 + 200 * 1800) / (150 * 3600 + 100 * 1800)
    expect(series[0].efficiencyFactor).toBeCloseTo(ef, 6)
  })

  it('功率或心率缺失的活动不参与效率因子', () => {
    const activities = [
      makeActivity('2026-08-17T08:00:00.000Z', { normalizedPower: 300, avgHeartRate: 150 }),
      makeActivity('2026-08-19T08:00:00.000Z', { normalizedPower: 200 }), // 无心率
      makeActivity('2026-08-20T08:00:00.000Z', { avgHeartRate: 140 }), // 无功率
    ]
    const series = buildWeeklySeries(activities, 1, undefined, new Date(2026, 7, 21))

    // 只有第一条参与：EF = 300/150 = 2
    expect(series[0].efficiencyFactor).toBeCloseTo(2, 6)
  })

  it('无 FTP 时 TSS 为 undefined，有 FTP 时按 IF 现算', () => {
    const activities = [
      makeActivity('2026-08-17T08:00:00.000Z', { normalizedPower: 300 }),
    ]

    const withoutFtp = buildWeeklySeries(activities, 1, undefined, new Date(2026, 7, 21))
    expect(withoutFtp[0].tss).toBeUndefined()

    const withFtp = buildWeeklySeries(activities, 1, 250, new Date(2026, 7, 21))
    // IF = 300/250 = 1.2，TSS = 3600 × 1.44 / 36 = 144
    expect(withFtp[0].tss).toBeCloseTo(144, 6)
  })

  it('无功率数据时 EF 与 TSS 均为 undefined', () => {
    const series = buildWeeklySeries(
      [makeActivity('2026-08-17T08:00:00.000Z')],
      1,
      250,
      new Date(2026, 7, 21),
    )

    expect(series[0].efficiencyFactor).toBeUndefined()
    expect(series[0].tss).toBeUndefined()
  })
})

describe('buildWeekReview', () => {
  it('返回目标周与上一周聚合', () => {
    const activities = [
      makeActivity('2026-08-17T08:00:00.000Z'), // 目标周
      makeActivity('2026-08-10T08:00:00.000Z'), // 上一周
    ]
    const review = buildWeekReview(activities, '2026-08-17')

    expect(review.current.weekStart).toBe('2026-08-17')
    expect(review.current.rides).toBe(1)
    expect(review.previous.weekStart).toBe('2026-08-10')
    expect(review.previous.rides).toBe(1)
  })

  it('目标周无数据时返回零值周', () => {
    const activities: WeekActivity[] = []
    const review = buildWeekReview(activities, '2026-08-17')

    expect(review.current.rides).toBe(0)
    expect(review.current.distance).toBe(0)
  })
})