/**
 * 有氧效率月度趋势测试（无功率计场景）。
 *
 * 验证：AE = 平均速度 ÷ 平均心率按时长加权、缺平均速度或平均心率
 * 的活动不参与、空月 value=undefined 不伪造、序列长度恒等于月数且升序。
 */
import { describe, expect, it } from 'vitest'
import {
  buildMonthlyAerobicEfficiency,
  type AerobicEfficiencyInput,
} from '@/features/analysis/aerobicEfficiency'

/**
 * 构造聚合参与活动。
 *
 * @param startTime 开始时间（ISO 8601）
 * @param overrides 覆盖字段
 */
function makeActivity(
  startTime: string,
  overrides: Partial<AerobicEfficiencyInput> = {},
): AerobicEfficiencyInput {
  return {
    startTime,
    duration: 3600,
    avgSpeed: 8,
    avgHeartRate: 160,
    ...overrides,
  }
}

describe('buildMonthlyAerobicEfficiency', () => {
  it('AE 按骑行时长加权（Σ速度×时长 ÷ Σ心率×时长）', () => {
    const activities = [
      // 8 m/s / 160 bpm，3600s
      makeActivity('2026-08-05T08:00:00.000Z'),
      // 6 m/s / 120 bpm，1800s
      makeActivity('2026-08-20T08:00:00.000Z', { duration: 1800, avgSpeed: 6, avgHeartRate: 120 }),
    ]
    const series = buildMonthlyAerobicEfficiency(activities, 1, new Date(2026, 7, 24))

    expect(series).toHaveLength(1)
    expect(series[0].month).toBe('2026-08')
    expect(series[0].value).toBeCloseTo((8 * 3600 + 6 * 1800) / (160 * 3600 + 120 * 1800), 6)
  })

  it('缺平均速度或平均心率的活动不参与聚合', () => {
    const activities = [
      makeActivity('2026-08-05T08:00:00.000Z', { avgSpeed: undefined }),
      makeActivity('2026-08-06T08:00:00.000Z', { avgHeartRate: undefined }),
      makeActivity('2026-08-07T08:00:00.000Z', { avgSpeed: 9, avgHeartRate: 150, duration: 7200 }),
    ]
    const series = buildMonthlyAerobicEfficiency(activities, 1, new Date(2026, 7, 24))

    expect(series[0].value).toBeCloseTo(9 / 150, 6)
  })

  it('空月份 value 为 undefined 且序列连续升序', () => {
    const activities = [makeActivity('2026-06-15T08:00:00.000Z')]
    const series = buildMonthlyAerobicEfficiency(activities, 4, new Date(2026, 7, 24))

    expect(series.map((month) => month.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ])
    expect(series[0].value).toBeUndefined()
    expect(series[1].value).toBeCloseTo(8 / 160, 6)
    expect(series[2].value).toBeUndefined()
    expect(series[3].value).toBeUndefined()
  })

  it('全部活动均不可参与时各月均为 undefined（不伪造数据）', () => {
    const activities = [
      makeActivity('2026-08-05T08:00:00.000Z', { avgHeartRate: undefined }),
    ]
    const series = buildMonthlyAerobicEfficiency(activities, 2, new Date(2026, 7, 24))

    expect(series.every((month) => month.value === undefined)).toBe(true)
  })
})
