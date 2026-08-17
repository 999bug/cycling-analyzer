/**
 * 赛段匹配纯函数测试（后续工作项：完整 Segment）。
 *
 * 验证顺序穿越判定（先入起点圈再入终点圈）、计时口径（两进入事件差）、
 * 半径边界、未完整穿越返回 undefined、成绩榜按用时升序。
 */
import { describe, expect, it } from 'vitest'
import {
  buildSegmentLeaderboard,
  matchSegmentEffort,
  SEGMENT_RADIUS_METERS,
  type SegmentGeometry,
} from '@/features/segments/segmentMatching'
import type { ActivityRecord } from '@/types/activity'

/** 测试赛段：起点 (31.2, 121.5)，终点 (31.3, 121.6)，相距约 14km */
const SEGMENT: SegmentGeometry = {
  startLatitude: 31.2,
  startLongitude: 121.5,
  endLatitude: 31.3,
  endLongitude: 121.6,
}

/**
 * 构造逐点轨迹。
 *
 * @param points [时间（秒）, 纬度, 经度] 元组
 */
function makeRecords(points: ReadonlyArray<readonly [number, number, number]>): ActivityRecord[] {
  return points.map(([timestamp, latitude, longitude]) => ({ timestamp, latitude, longitude }))
}

describe('matchSegmentEffort', () => {
  it('顺序穿越起终点圆：计时 = 进入终点 - 进入起点', () => {
    const records = makeRecords([
      [0, 31.19, 121.49], // 起点圈外
      [100, 31.2001, 121.5001], // 进入起点圈 → 计时起点
      [200, 31.25, 121.55], // 途中
      [900, 31.3001, 121.6001], // 进入终点圈 → 计时终点
      [1000, 31.31, 121.61], // 终点圈外
    ])
    expect(matchSegmentEffort(SEGMENT, records)).toBe(800)
  })

  it('终点圆出现在起点进入之前不算成绩', () => {
    const records = makeRecords([
      // 先经过终点圈（未入起点圈，忽略）
      [0, 31.3001, 121.6001],
      // 进入起点圈
      [100, 31.2001, 121.5001],
      // 之后再无终点进入
      [200, 31.21, 121.51],
    ])
    expect(matchSegmentEffort(SEGMENT, records)).toBeUndefined()
  })

  it('从未进入起点圆返回 undefined', () => {
    const records = makeRecords([
      [0, 31.0, 121.0],
      [100, 31.1, 121.1],
    ])
    expect(matchSegmentEffort(SEGMENT, records)).toBeUndefined()
  })

  it('进入起点后未进入终点返回 undefined', () => {
    const records = makeRecords([
      [0, 31.2001, 121.5001],
      [100, 31.21, 121.51],
    ])
    expect(matchSegmentEffort(SEGMENT, records)).toBeUndefined()
  })

  it('无坐标点跳过不影响匹配', () => {
    const records: ActivityRecord[] = [
      { timestamp: 0, power: 200 },
      { timestamp: 100, latitude: 31.2001, longitude: 121.5001 },
      { timestamp: 200, power: 210 },
      { timestamp: 500, latitude: 31.3001, longitude: 121.6001 },
    ]
    expect(matchSegmentEffort(SEGMENT, records)).toBe(400)
  })

  it('半径边界：圈外 300m 不入圈，圈内 100m 入圈', () => {
    // 纬度 0.001° ≈ 111m；0.003° ≈ 333m > 200m 半径
    const outside = makeRecords([
      [0, 31.203, 121.5], // 距起点圆心约 333m：圈外
      [100, 31.3001, 121.6001],
    ])
    expect(matchSegmentEffort(SEGMENT, outside)).toBeUndefined()

    const inside = makeRecords([
      [0, 31.201, 121.5], // 距起点圆心约 111m：圈内
      [100, 31.301, 121.6], // 距终点圆心约 111m：圈内
    ])
    expect(matchSegmentEffort(SEGMENT, inside)).toBe(100)
  })

  it('半径常量为 200m', () => {
    expect(SEGMENT_RADIUS_METERS).toBe(200)
  })
})

describe('buildSegmentLeaderboard', () => {
  it('各活动首次穿越上榜，按用时升序，无穿越不出现', () => {
    const inputs = [
      {
        activityId: 'slow',
        startTime: '2026-08-01T08:00:00',
        records: makeRecords([
          [0, 31.2001, 121.5001],
          [1000, 31.3001, 121.6001],
        ]),
      },
      {
        activityId: 'fast',
        startTime: '2026-08-02T08:00:00',
        records: makeRecords([
          [0, 31.2001, 121.5001],
          [600, 31.3001, 121.6001],
        ]),
      },
      {
        activityId: 'miss',
        startTime: '2026-08-03T08:00:00',
        records: makeRecords([[0, 30.0, 120.0]]),
      },
    ]

    const board = buildSegmentLeaderboard(SEGMENT, inputs)
    expect(board.map((effort) => effort.activityId)).toEqual(['fast', 'slow'])
    expect(board[0]).toMatchObject({ durationSeconds: 600, startTime: '2026-08-02T08:00:00' })
    expect(board[1]).toMatchObject({ durationSeconds: 1000 })
  })

  it('空输入返回空榜', () => {
    expect(buildSegmentLeaderboard(SEGMENT, [])).toEqual([])
  })
})
