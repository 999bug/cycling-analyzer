/**
 * 赛段匹配纯函数测试（后续工作项：完整 Segment）。
 *
 * 验证顺序穿越判定（入起点圈 → 离开起点圈 → 入终点圈）、计时口径（两进入事件差）、
 * 环形路线防护（离开起点圈后回到起点才完赛）、多圈取最佳、重新进入起点圈重计时、
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

  it('环形路线（起终点同圆）：离开后再回来记整圈用时，不再出发即完赛', () => {
    // 起点 = 终点（家门口绕圈）：旧算法出发下一秒就"完赛"
    const loop: SegmentGeometry = {
      startLatitude: 31.2,
      startLongitude: 121.5,
      endLatitude: 31.2,
      endLongitude: 121.5,
    }
    const records = makeRecords([
      [0, 31.2001, 121.5001], // 家（两圈重叠，同时在起终点圈内）
      [60, 31.2005, 121.5005], // 仍在圈内（出发停留，不计入成绩）
      [120, 31.25, 121.55], // 离开
      [1800, 31.2001, 121.5001], // 绕圈回家 → 完赛，计时起点为圈内最后一点 60
      [1860, 31.2002, 121.5002], // 仍在家
    ])
    expect(matchSegmentEffort(loop, records)).toBe(1740)
  })

  it('起点圈内停留时间不计入成绩（开机热身后再出发）', () => {
    // 家 = 起点圈：开机定位、热身 180 秒后才动身，停留时间不应计入
    const records = makeRecords([
      [0, 31.2001, 121.5001], // 开机（起点圈内）
      [60, 31.2002, 121.5001], // 停留
      [180, 31.2003, 121.5002], // 停留结束，即将动身 → 计时起点
      [240, 31.21, 121.51], // 离开起点圈
      [600, 31.3001, 121.6001], // 进入终点圈 → 600-180=420
    ])
    expect(matchSegmentEffort(SEGMENT, records)).toBe(420)
  })

  it('相交圆（圆心距 < 2R）：出起点圈一步撞进终点圈不判完赛', () => {
    // 真实场景还原：家门口建段，起终点圆心仅差约 44m（两圆几乎重叠）；
    // 出起点圈的点仍在终点圈内，若判完赛会产生 1 秒虚假成绩
    const nearLoop: SegmentGeometry = {
      startLatitude: 31.2,
      startLongitude: 121.5,
      endLatitude: 31.2004, // 北约 44m
      endLongitude: 121.5,
    }
    const records = makeRecords([
      [0, 31.2001, 121.5001], // 家（两圆并集内）
      [33, 31.2002, 121.5002], // 停留最后点 → 计时起点
      [34, 31.202, 121.5], // 出起点圈（约 222m）但距终点约 178m 仍在终点圈
      [40, 31.205, 121.5], // 真正离开两圆并集
      [1358, 31.2001, 121.5001], // 绕圈回家 → 完赛 1358-33=1325
    ])
    expect(matchSegmentEffort(nearLoop, records)).toBe(1325)
  })

  it('环形多圈：取最佳圈而非首圈', () => {
    const loop: SegmentGeometry = {
      startLatitude: 31.2,
      startLongitude: 121.5,
      endLatitude: 31.2,
      endLongitude: 121.5,
    }
    const records = makeRecords([
      [0, 31.2001, 121.5001], // 起点
      [10, 31.25, 121.55], // 离开
      [600, 31.2001, 121.5001], // 第 1 圈 600s（同时是下一圈起点）
      [610, 31.25, 121.55], // 离开
      [1050, 31.2001, 121.5001], // 第 2 圈 450s（最佳）
      [1060, 31.25, 121.55], // 离开
      [1600, 31.2001, 121.5001], // 第 3 圈 550s
    ])
    expect(matchSegmentEffort(loop, records)).toBe(450)
  })

  it('重新进入起点圈：从最后一次进入重新计时', () => {
    const records = makeRecords([
      [0, 31.2001, 121.5001], // 首次进入起点圈
      [10, 31.25, 121.55], // 离开（未达终点）
      [900, 31.2001, 121.5001], // 重新进入起点圈 → 重新计时
      [910, 31.25, 121.55], // 离开
      [1200, 31.3001, 121.6001], // 进入终点圈 → 1200-900=300
    ])
    expect(matchSegmentEffort(SEGMENT, records)).toBe(300)
  })
})

describe('buildSegmentLeaderboard', () => {
  it('各活动最佳穿越上榜，按用时升序，无穿越不出现', () => {
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

/**
 * 路径校验性能优化回归（GPX 导入卡死修复）：
 * 包围盒预筛 + 轨迹抽稀 + 中位数提前退出 + 穿越段级校验缓存。
 * 判定语义与旧实现一致：中位距离 ≤ 100m 通过，> 100m 拒绝。
 */
describe('路径校验性能优化', () => {
  /** 构造沿给定折线均匀分布的轨迹点（每米约 1 点） */
  function makeTrack(
    points: ReadonlyArray<readonly [number, number]>,
  ): [number, number][] {
    return points.map(([lat, lng]) => [lat, lng] as [number, number])
  }

  it('带轨迹赛段：路径重合的活动计成绩，偏离路径的不计', () => {
    // 赛段轨迹：起点 → 终点直线（约 14km）
    const track = makeTrack([
      [31.2, 121.5],
      [31.25, 121.55],
      [31.3, 121.6],
    ])
    const withTrack: SegmentGeometry = { ...SEGMENT, trackPoints: track }

    const onPath = makeRecords([
      [0, 31.2001, 121.5001],
      [300, 31.25, 121.55],
      [600, 31.3001, 121.6001],
    ])
    expect(matchSegmentEffort(withTrack, onPath)).toBe(600)

    // 起终点圆命中但途中多数点偏到完全不同的位置（模拟另一条路/折返误匹配）。
    // 中位数口径：起终点圆内的端点距轨迹≈0，需超过半数 GPS 点偏离才拒绝，
    // 因此构造 6 点中 4 个偏离（>半数）的场景
    const offPath = makeRecords([
      [0, 31.2001, 121.5001],
      [10, 31.28, 121.38], // 偏离赛段轨迹 > 100m（约 16km）
      [20, 31.27, 121.39], // 偏离
      [25, 31.26, 121.40], // 偏离
      [30, 31.29, 121.37], // 偏离
      [35, 31.3001, 121.6001],
    ])
    expect(matchSegmentEffort(withTrack, offPath)).toBeUndefined()
  })

  it('超长赛段轨迹抽稀后判定结果与短轨迹一致（≤200 点采样不翻转语义）', () => {
    // 构造 5000 点的密集赛段轨迹（起终点之间线性插值 + 微小抖动）
    const dense: [number, number][] = []
    for (let i = 0; i < 5000; i += 1) {
      const t = i / 4999
      dense.push([31.2 + 0.1 * t, 121.5 + 0.1 * t])
    }
    const sparse: SegmentGeometry = { ...SEGMENT, trackPoints: [[31.2, 121.5], [31.3, 121.6]] }
    const denseSegment: SegmentGeometry = { ...SEGMENT, trackPoints: dense }

    const records = makeRecords([
      [0, 31.2001, 121.5001],
      [300, 31.25, 121.55],
      [600, 31.3001, 121.6001],
    ])
    expect(matchSegmentEffort(denseSegment, records)).toBe(600)
    expect(matchSegmentEffort(sparse, records)).toBe(600)
  })

  it('包围盒外的活动点直接判超阈值（盒内盒外混合仍按中位数口径）', () => {
    // 赛段在 (31.2,121.5)~(31.3,121.6)；活动穿越途中大部分点远在包围盒外
    const track: SegmentGeometry = {
      ...SEGMENT,
      trackPoints: [
        [31.2, 121.5],
        [31.21, 121.51],
        [31.22, 121.52],
        [31.23, 121.53],
        [31.24, 121.54],
        [31.25, 121.55],
      ],
    }
    // 5 个 GPS 点中 3 个在盒外（>半数超阈值 → 提前失败）
    const mostlyOutside = makeRecords([
      [0, 31.2001, 121.5001],
      [10, 30.5, 120.9],
      [20, 30.6, 121.0],
      [30, 30.7, 121.1],
      [40, 31.3001, 121.6001],
    ])
    expect(matchSegmentEffort(track, mostlyOutside)).toBeUndefined()

    // 仅 1 点在盒外（<半数超阈值 → 中位数仍 ≤ 阈值 → 通过）
    const fewOutside = makeRecords([
      [0, 31.2001, 121.5001],
      [10, 30.5, 120.9],
      [20, 31.21, 121.51], // 恰为赛段轨迹顶点（距离 0）
      [30, 31.23, 121.53], // 恰为赛段轨迹顶点（距离 0）
      [40, 31.3001, 121.6001],
    ])
    expect(matchSegmentEffort(track, fewOutside)).toBe(40)
  })

  it('同一穿越段反复撞终点圆只做一次路径校验（缓存生效，结果不变）', () => {
    const track: SegmentGeometry = {
      ...SEGMENT,
      trackPoints: [
        [31.2, 121.5],
        [31.25, 121.55],
        [31.3, 121.6],
      ],
    }
    // 完赛后继续留在终点圈内多帧（每次 inEnd 都触发判定入口）
    const records = makeRecords([
      [0, 31.2001, 121.5001],
      [300, 31.25, 121.55],
      [600, 31.3001, 121.6001],
      [620, 31.3002, 121.6002],
      [640, 31.3003, 121.6003],
    ])
    expect(matchSegmentEffort(track, records)).toBe(600)
  })

  it('环形赛段带轨迹：绕圈回家路径重合才计成绩', () => {
    const loop: SegmentGeometry = {
      startLatitude: 31.2,
      startLongitude: 121.5,
      endLatitude: 31.2,
      endLongitude: 121.5,
      trackPoints: [
        [31.2, 121.5],
        [31.25, 121.55],
        [31.2, 121.5],
      ],
    }
    const records = makeRecords([
      [0, 31.2001, 121.5001],
      [60, 31.2005, 121.5005],
      [120, 31.25, 121.55],
      [1800, 31.2001, 121.5001],
    ])
    expect(matchSegmentEffort(loop, records)).toBe(1740)
  })
})

