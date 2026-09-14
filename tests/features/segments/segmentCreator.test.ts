/**
 * 地图框选建段纯函数测试（二期）。
 *
 * 覆盖：最近点吸附、草稿构建（正向/反向/轨迹切片/距离）、方向一致性判定。
 */
import { describe, expect, it } from 'vitest'
import {
  buildSegmentDraft,
  effortMatchesDirection,
  nearestRecordIndex,
} from '@/features/segments/segmentCreator'
import type { ActivityRecord } from '@/types/activity'

/** 沿起终点连线（31.2,121.5 → 31.3,121.6）的 101 点轨迹，1 秒 1 点 */
function makeTrackRecords(): ActivityRecord[] {
  const records: ActivityRecord[] = []
  for (let i = 0; i <= 100; i += 1) {
    records.push({
      timestamp: i,
      latitude: 31.2 + (0.1 * i) / 100,
      longitude: 121.5 + (0.1 * i) / 100,
    })
  }
  return records
}

describe('nearestRecordIndex', () => {
  it('吸附到最近的带坐标记录', () => {
    const records = makeTrackRecords()
    // 目标点取 i=50 附近（0.05° 偏差在相邻点间距 0.001° 内）
    expect(nearestRecordIndex(records, 31.25, 121.55)).toBe(50)
  })

  it('无坐标记录时返回 undefined', () => {
    expect(nearestRecordIndex([{ timestamp: 0 }], 31.2, 121.5)).toBeUndefined()
  })
})

describe('buildSegmentDraft', () => {
  it('正向选取：起点在前，轨迹切片与距离齐备', () => {
    const draft = buildSegmentDraft(makeTrackRecords(), 10, 60)
    expect(draft).toBeDefined()
    expect(draft!.direction).toBe('forward')
    expect(draft!.startLatitude).toBeCloseTo(31.21, 5)
    expect(draft!.endLatitude).toBeCloseTo(31.26, 5)
    expect(draft!.trackPoints).toHaveLength(51)
    // 50 秒走 0.05° ≈ 7.3km 量级
    expect(draft!.distanceMeters).toBeGreaterThan(5000)
  })

  it('反向选取：自动归一（时间序在前的为起点），direction = reverse', () => {
    const draft = buildSegmentDraft(makeTrackRecords(), 60, 10)
    expect(draft!.direction).toBe('reverse')
    // 起点仍是时间序在前（i=10）的点
    expect(draft!.startLatitude).toBeCloseTo(31.21, 5)
    expect(draft!.endLatitude).toBeCloseTo(31.26, 5)
  })

  it('任一索引无坐标返回 undefined', () => {
    const records: ActivityRecord[] = [
      { timestamp: 0, latitude: 31.2, longitude: 121.5 },
      { timestamp: 1 },
    ]
    expect(buildSegmentDraft(records, 0, 1)).toBeUndefined()
    expect(buildSegmentDraft(records, 0, 9)).toBeUndefined()
  })
})

describe('effortMatchesDirection', () => {
  const SEGMENT = {
    startLatitude: 31.2,
    startLongitude: 121.5,
    endLatitude: 31.3,
    endLongitude: 121.6,
  }

  it('正向穿越（沿起点 → 终点位移）返回 true', () => {
    expect(effortMatchesDirection(SEGMENT, makeTrackRecords(), 0, 100)).toBe(true)
  })

  it('反向穿越（时间倒着走）返回 false', () => {
    // 时间升序但坐标从终点走向起点 = 反向骑行
    const reversed = makeTrackRecords()
      .slice()
      .reverse()
      .map((record, index) => ({ ...record, timestamp: index }))
    expect(effortMatchesDirection(SEGMENT, reversed, 0, 100)).toBe(false)
  })

  it('窗口内无 GPS 点返回 undefined', () => {
    expect(
      effortMatchesDirection(SEGMENT, [{ timestamp: 5, power: 200 }], 0, 10),
    ).toBeUndefined()
  })
})
