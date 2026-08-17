/**
 * 图表序列转换测试（规格 §17）：时间/距离轴切换、缺失字段过滤。
 */
import { describe, expect, it } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import { buildSeries } from '@/charts/series'

/**
 * 构造逐点记录（未提供的可选字段为 undefined，模拟缺失）。
 */
function makeRecord(overrides: Partial<ActivityRecord> & { timestamp: number }): ActivityRecord {
  return { ...overrides }
}

describe('buildSeries', () => {
  it('time 模式：x 为距起点的秒数，输入乱序时按时间升序输出', () => {
    const records = [
      makeRecord({ timestamp: 30, speed: 10 }),
      makeRecord({ timestamp: 10, speed: 8 }),
      makeRecord({ timestamp: 20, speed: 9 }),
    ]
    const series = buildSeries(records, 'speed', 'time')
    expect(series).toEqual([
      { x: 0, y: 8, timestamp: 10 },
      { x: 10, y: 9, timestamp: 20 },
      { x: 20, y: 10, timestamp: 30 },
    ])
  })

  it('distance 模式：x 为距起点的累计距离（米）', () => {
    const records = [
      makeRecord({ timestamp: 10, speed: 8, distance: 100 }),
      makeRecord({ timestamp: 20, speed: 9, distance: 300 }),
      makeRecord({ timestamp: 30, speed: 10, distance: 700 }),
    ]
    const series = buildSeries(records, 'speed', 'distance')
    expect(series.map((p) => p.x)).toEqual([0, 200, 600])
    expect(series.map((p) => p.y)).toEqual([8, 9, 10])
  })

  it('缺失指标字段的记录被过滤，不产生 0 值假数据', () => {
    const records = [
      makeRecord({ timestamp: 10, heartRate: 150 }),
      makeRecord({ timestamp: 20 }), // 心率缺失
      makeRecord({ timestamp: 30, heartRate: 160 }),
    ]
    const series = buildSeries(records, 'heartRate', 'time')
    expect(series).toHaveLength(2)
    expect(series.map((p) => p.y)).toEqual([150, 160])
  })

  it('distance 模式下累计距离缺失的记录被过滤', () => {
    const records = [
      makeRecord({ timestamp: 10, power: 200, distance: 100 }),
      makeRecord({ timestamp: 20, power: 210 }), // distance 缺失
      makeRecord({ timestamp: 30, power: 220, distance: 400 }),
    ]
    const series = buildSeries(records, 'power', 'distance')
    expect(series.map((p) => p.x)).toEqual([0, 300])
    expect(series.map((p) => p.y)).toEqual([200, 220])
  })

  it('同一批数据在时间/距离轴下 x 值不同（轴切换语义）', () => {
    const records = [
      makeRecord({ timestamp: 0, altitude: 100, distance: 0 }),
      makeRecord({ timestamp: 600, altitude: 120, distance: 2000 }),
    ]
    const byTime = buildSeries(records, 'altitude', 'time')
    const byDistance = buildSeries(records, 'altitude', 'distance')
    expect(byTime.map((p) => p.x)).toEqual([0, 600])
    expect(byDistance.map((p) => p.x)).toEqual([0, 2000])
  })

  it('无有效数据时返回空数组', () => {
    expect(buildSeries([], 'power', 'time')).toEqual([])
    const records = [makeRecord({ timestamp: 1 })] // 功率全部缺失
    expect(buildSeries(records, 'power', 'time')).toEqual([])
  })
})
