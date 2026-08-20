/**
 * 分段分析测试（buildSegments / climbInsights）。
 *
 * 构造带速度/功率/心率的逐点记录，验证平路/爬坡交替分段、
 * 每段统计均值正确、相邻爬坡对比洞察文案。
 */
import { describe, expect, it } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import { buildClimbs } from '@/features/activity/climbs'
import { buildSegments, climbInsights } from '@/features/activity/segments'

/**
 * 构造逐点记录：含海拔/距离/速度/功率/心率。
 *
 * @param specs [距离, 海拔, 速度m/s, 功率W, 心率bpm] 元组
 * @param baseTimestamp 起始时间戳
 * @param stepSeconds 相邻点时间间隔（秒）
 */
function makeRecords(
  specs: Array<[number, number, number, number, number]>,
  baseTimestamp = 0,
  stepSeconds = 10,
): ActivityRecord[] {
  return specs.map(([distance, altitude, speed, power, heartRate], index) => ({
    timestamp: baseTimestamp + index * stepSeconds,
    latitude: 31.2 + index * 0.0001,
    longitude: 121.5 + index * 0.0001,
    distance,
    altitude,
    speed,
    power,
    heartRate,
  }))
}

describe('buildSegments 分段', () => {
  it('平路 → 爬坡 → 平路交替分段（首末平路 + 中间爬坡）', () => {
    // 0-1000m 平路（海拔不变）→ 1000-3000m 爬坡（2000m 爬 100m = 5%）→ 3000-4000m 平路
    const records = makeRecords([
      [0, 100, 8, 150, 120],
      [250, 100, 8, 150, 120],
      [500, 100, 8, 150, 120],
      [750, 100, 8, 150, 120],
      [1000, 100, 8, 150, 120],
      [1250, 125, 4, 250, 160],
      [1500, 150, 4, 250, 160],
      [1750, 175, 4, 250, 160],
      [2000, 200, 4, 250, 160],
      [2250, 200, 6, 200, 150],
      [2500, 200, 6, 200, 150],
      [2750, 200, 6, 200, 150],
      [3000, 200, 6, 200, 150],
      [3250, 200, 8, 150, 120],
      [3500, 200, 8, 150, 120],
      [3750, 200, 8, 150, 120],
      [4000, 200, 8, 150, 120],
    ])
    const climbs = buildClimbs(records)
    expect(climbs).toHaveLength(1)

    const segments = buildSegments(records, climbs)

    // 平路1(0-1000) → 爬坡1(1000-2000，坡后平台 2000-3000 归平路) → 平路2(2000-4000)
    expect(segments.map((segment) => segment.type)).toEqual(['flat', 'climb', 'flat'])
    expect(segments[0].startDistanceMeters).toBe(0)
    expect(segments[0].endDistanceMeters).toBe(1000)
    expect(segments[1].startDistanceMeters).toBe(1000)
    expect(segments[1].endDistanceMeters).toBe(2000)
    expect(segments[2].startDistanceMeters).toBe(2000)
    expect(segments[2].endDistanceMeters).toBe(4000)
  })

  it('无爬坡时整条路线为单段平路', () => {
    const records = makeRecords([
      [0, 100, 8, 150, 120],
      [500, 100, 8, 150, 120],
      [1000, 100, 8, 150, 120],
    ])
    const segments = buildSegments(records, [])

    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('flat')
    expect(segments[0].distanceMeters).toBe(1000)
  })

  it('爬坡段统计平均速度/功率/心率正确', () => {
    // 1500-2500m 爬坡段：平均速度 4m/s、功率 250W、心率 160bpm
    const records = makeRecords([
      [1500, 100, 4, 250, 160],
      [1750, 120, 4, 250, 160],
      [2000, 140, 4, 250, 160],
      [2250, 160, 4, 250, 160],
      [2500, 180, 4, 250, 160],
    ])
    const climbs = buildClimbs(records)
    const segments = buildSegments(records, climbs)
    const climb = segments.find((segment) => segment.type === 'climb')

    expect(climb?.avgSpeedMps).toBe(4)
    expect(climb?.avgPowerW).toBe(250)
    expect(climb?.avgHeartRateBpm).toBe(160)
    expect(climb?.elevationGain).toBe(80)
    expect(climb?.avgGradePercent).toBeCloseTo(8, 0)
  })

  it('缺失指标的区间统计为 undefined（不伪造 0）', () => {
    const records: ActivityRecord[] = [
      { timestamp: 0, distance: 0, altitude: 100, speed: 8 },
      { timestamp: 10, distance: 500, altitude: 120, speed: 8 },
      { timestamp: 20, distance: 1000, altitude: 140, speed: 8 },
    ]
    const climbs = buildClimbs(records)
    const segments = buildSegments(records, climbs)
    const climb = segments.find((segment) => segment.type === 'climb')

    expect(climb?.avgPowerW).toBeUndefined()
    expect(climb?.avgHeartRateBpm).toBeUndefined()
    expect(climb?.avgSpeedMps).toBe(8)
  })
})

describe('climbInsights 相邻爬坡对比洞察', () => {
  it('第二段爬坡功率高但速度低时生成对比文案', () => {
    // 爬坡1（1000-2000m）：速度 4m/s、功率 200W；爬坡2（3000-4000m）：速度 3m/s、功率 240W
    const records = makeRecords([
      [1000, 100, 4, 200, 150],
      [1250, 125, 4, 200, 150],
      [1500, 150, 4, 200, 150],
      [1750, 175, 4, 200, 150],
      [2000, 200, 4, 200, 150],
      [2500, 175, 6, 150, 130], // 中间下坡（坡度平缓，不会触发尖刺跳变）
      [3000, 150, 3, 240, 160],
      [3250, 175, 3, 240, 160],
      [3500, 200, 3, 240, 160],
      [3750, 225, 3, 240, 160],
      [4000, 250, 3, 240, 160],
    ])
    const climbs = buildClimbs(records)
    expect(climbs).toHaveLength(2)

    const segments = buildSegments(records, climbs)
    const insights = climbInsights(segments)

    expect(insights).toHaveLength(1)
    // 240 vs 200 → +20%；3 vs 4 → -25%
    expect(insights[0].text).toContain('爬坡 2比爬坡 1')
    expect(insights[0].text).toContain('平均功率高 20.0%')
    expect(insights[0].text).toContain('但速度低 25.0%')
  })

  it('无功率/速度数据时不生成洞察', () => {
    const records = makeRecords([
      [1000, 100, 4, 200, 150],
      [1250, 125, 4, 200, 150],
      [1500, 150, 4, 200, 150],
      [1750, 175, 4, 200, 150],
      [2000, 200, 4, 200, 150],
      [2500, 175, 4, 200, 150], // 下坡
      [3000, 150, 4, 200, 150],
      [3250, 175, 4, 200, 150],
      [3500, 200, 4, 200, 150],
      [3750, 225, 4, 200, 150],
      [4000, 250, 4, 200, 150],
    ])
    const climbs = buildClimbs(records)
    const segments = buildSegments(records, climbs)

    expect(climbInsights(segments)).toEqual([])
  })

  it('仅一段爬坡时无洞察', () => {
    const records = makeRecords([
      [1000, 100, 4, 200, 150],
      [1250, 125, 4, 200, 150],
      [1500, 150, 4, 200, 150],
      [1750, 175, 4, 200, 150],
      [2000, 200, 4, 200, 150],
    ])
    const climbs = buildClimbs(records)
    const segments = buildSegments(records, climbs)

    expect(climbInsights(segments)).toEqual([])
  })
})