/**
 * 统计计算器测试：从标准化记录计算活动汇总。
 */
import { describe, expect, it } from 'vitest'
import { calculateSummary } from '@/fit/calculator/calculator'
import type { ActivityRecord } from '@/types/activity'

/**
 * 构造带海拔的测试记录。
 */
function recordsWithAltitude(altitudes: (number | undefined)[]): ActivityRecord[] {
  return altitudes.map((altitude, i) => ({
    timestamp: 1735689600 + i,
    altitude,
    distance: i * 10,
    speed: 5,
  }))
}

describe('calculateSummary 爬升与下降', () => {
  it('累计相邻正海拔增量（精确值）', () => {
    const records = recordsWithAltitude([100, 102, 101, 105, 103])

    const summary = calculateSummary(records)

    // 100→102 +2、102→101 0、101→105 +4、105→103 0
    expect(summary.elevationGain).toBe(6)
    // 102→101 -1、105→103 -2
    expect(summary.elevationLoss).toBe(3)
  })

  it('海拔缺失时跳过计算', () => {
    const records = recordsWithAltitude([100, undefined, 104, 104, 101])

    const summary = calculateSummary(records)

    // 100→104（跳过中间缺失点）+4、104→101 0
    expect(summary.elevationGain).toBe(4)
    expect(summary.elevationLoss).toBe(3)
  })
})

describe('calculateSummary 基础统计', () => {
  it('距离取末点累计距离', () => {
    const records = recordsWithAltitude([100, 101, 102])

    const summary = calculateSummary(records)

    expect(summary.distance).toBe(20)
  })

  it('无距离字段时按速度-时间估算', () => {
    const records = [
      { timestamp: 1735689600, speed: 5 },
      { timestamp: 1735689610, speed: 6 },
      { timestamp: 1735689620, speed: 4 },
    ]

    const summary = calculateSummary(records)

    // 无距离字段：按前点速度 × 间隔累加：5*10 + 6*10 = 110
    expect(summary.distance).toBeCloseTo(110, 2)
  })

  it('平均速度 = 距离 / 时长（有会话时用会话计时）', () => {
    const records = recordsWithAltitude([100, 100, 100])

    const summary = calculateSummary(records, {
      totalTimerTime: 600,
      totalDistance: 2400,
    })

    expect(summary.duration).toBe(600)
    expect(summary.distance).toBe(20)
    expect(summary.avgSpeed).toBeCloseTo(20 / 600, 6)
  })

  it('无会话时用时记录首末时间差', () => {
    const records = [
      { timestamp: 1735689600, distance: 0, speed: 5 },
      { timestamp: 1735689700, distance: 500, speed: 5 },
    ]

    const summary = calculateSummary(records)

    expect(summary.duration).toBe(100)
    expect(summary.avgSpeed).toBe(5)
  })
})

describe('calculateSummary 心率/功率/踏频', () => {
  it('平均与最高心率仅统计非空值', () => {
    const records = [
      { timestamp: 1, heartRate: 130 },
      { timestamp: 2, heartRate: undefined },
      { timestamp: 3, heartRate: 150 },
      { timestamp: 4, heartRate: 120 },
    ]

    const summary = calculateSummary(records)

    expect(summary.avgHeartRate).toBeCloseTo(400 / 3, 2)
    expect(summary.maxHeartRate).toBe(150)
  })

  it('字段完全缺失时为 undefined 而非 0', () => {
    const records = [
      { timestamp: 1, distance: 10 },
      { timestamp: 2, distance: 20 },
    ]

    const summary = calculateSummary(records)

    expect(summary.avgHeartRate).toBeUndefined()
    expect(summary.maxHeartRate).toBeUndefined()
    expect(summary.avgPower).toBeUndefined()
    expect(summary.avgCadence).toBeUndefined()
    expect(summary.calories).toBeUndefined()
  })

  it('卡路里从会话原始数据保留', () => {
    const records = recordsWithAltitude([100, 100])

    const summary = calculateSummary(records, { totalCalories: 345 })

    expect(summary.calories).toBe(345)
  })
})

describe('calculateSummary 边界', () => {
  it('空记录集不抛错', () => {
    const summary = calculateSummary([])

    expect(summary.distance).toBe(0)
    expect(summary.duration).toBe(0)
    expect(summary.elevationGain).toBe(0)
    expect(summary.avgSpeed).toBeUndefined()
  })

  it('单条记录安全处理', () => {
    const records = [{ timestamp: 1735689600, distance: 0 }]

    const summary = calculateSummary(records)

    expect(summary.duration).toBe(0)
    expect(summary.avgSpeed).toBeUndefined()
  })
})
