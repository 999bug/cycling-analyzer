/**
 * 本地赛段挖掘纯函数测试（三期）。
 *
 * 构造 6 条活动反复经过同一条 ~1.1km 直线路段（跨 3+ 个网格），
 * 验证热格统计 → 热格对共现 → 候选段产出与既有段去重。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MINING_PARAMS,
  filterCandidatesAgainstExisting,
  mineSegmentCandidates,
  type MiningInput,
} from '@/features/segments/segmentMining'
import type { ActivityRecord } from '@/types/activity'

/** 沿 (31.200,121.500) → (31.202,121.512) 直线（≈1.16km）生成一条活动轨迹 */
function makeCorridorRecords(activitySeed: number): ActivityRecord[] {
  const records: ActivityRecord[] = []
  const total = 200
  for (let i = 0; i <= total; i += 1) {
    const ratio = i / total
    // 每条活动带一点横向抖动（GPS 噪声量级，不跨格）
    const jitter = Math.sin(activitySeed * 7 + i) * 0.0002
    records.push({
      timestamp: i * 3,
      latitude: 31.2 + 0.002 * ratio + jitter,
      longitude: 121.5 + 0.012 * ratio + jitter,
    })
  }
  return records
}

/** 6 条活动经过同一路段 + 2 条只出现在别处的活动 */
function makeInputs(): MiningInput[] {
  const inputs: MiningInput[] = []
  for (let seed = 0; seed < 6; seed += 1) {
    inputs.push({ activityId: `corridor-${seed}`, records: makeCorridorRecords(seed) })
  }
  // 对照组：孤立区域各 1 条（远低于热格门槛）
  for (let seed = 0; seed < 2; seed += 1) {
    inputs.push({
      activityId: `isolated-${seed}`,
      records: [
        { timestamp: 0, latitude: 30.0 + seed * 0.05, longitude: 120.0 },
        { timestamp: 100, latitude: 30.02 + seed * 0.05, longitude: 120.02 },
      ],
    })
  }
  return inputs
}

describe('mineSegmentCandidates', () => {
  it('挖掘出被 6 次活动反复经过的路段候选', () => {
    const candidates = mineSegmentCandidates(makeInputs())
    // 同一走廊的多个格对变体被去重为一个
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]
    // 起终点落在走廊内（格中心，容差一格；去重保留的变体不一定覆盖到全程末端）
    expect(candidate.startLatitude).toBeCloseTo(31.2, 2)
    expect(candidate.endLatitude).toBeCloseTo(31.202, 2)
    expect(candidate.startLongitude).toBeGreaterThanOrEqual(121.5)
    expect(candidate.endLongitude).toBeGreaterThan(candidate.startLongitude)
    expect(candidate.endLongitude).toBeLessThanOrEqual(121.512)
    // 共现数 = 全部 6 条活动
    expect(candidate.coOccurrence).toBe(6)
    // 代表轨迹有切片且距离在量级内
    expect(candidate.trackPoints.length).toBeGreaterThan(10)
    expect(candidate.distanceMeters).toBeGreaterThan(300)
    expect(candidate.distanceMeters).toBeLessThan(1400)
  })

  it('共现不足的活动区域不产出候选', () => {
    // 只有 2 条活动经过孤立区域，minCellActivities=6 时被过滤
    const candidates = mineSegmentCandidates(makeInputs())
    expect(
      candidates.some(
        (candidate) => candidate.startLatitude > 30 && candidate.startLatitude < 30.1,
      ),
    ).toBe(false)
  })

  it('候选间自动去重：同一路段只出一个候选', () => {
    // 参数放宽后同一路段会命中多对格对，去重后仍只 1 条
    const candidates = mineSegmentCandidates(makeInputs(), {
      ...DEFAULT_MINING_PARAMS,
      minPairMeters: 200,
      maxPairMeters: 1200,
    })
    expect(candidates).toHaveLength(1)
  })

  it('热格不足时返回空列表', () => {
    expect(mineSegmentCandidates(makeInputs().slice(6))).toEqual([])
  })
})

describe('filterCandidatesAgainstExisting', () => {
  const candidate = {
    startLatitude: 31.2,
    startLongitude: 121.5,
    endLatitude: 31.202,
    endLongitude: 121.512,
    trackPoints: [],
    distanceMeters: 1100,
    coOccurrence: 6,
  }

  it('起终点都与既有赛段互近（含反向）时过滤', () => {
    const existing = [
      { startLatitude: 31.2001, startLongitude: 121.5001, endLatitude: 31.2021, endLongitude: 121.5121 },
    ]
    expect(filterCandidatesAgainstExisting([candidate], existing)).toEqual([])
    // 反向重合也过滤
    const reversed = [
      { startLatitude: 31.2021, startLongitude: 121.5121, endLatitude: 31.2001, endLongitude: 121.5001 },
    ]
    expect(filterCandidatesAgainstExisting([candidate], reversed)).toEqual([])
  })

  it('不同位置的既有赛段不影响推荐', () => {
    const existing = [
      { startLatitude: 30.0, startLongitude: 120.0, endLatitude: 30.002, endLongitude: 120.012 },
    ]
    expect(filterCandidatesAgainstExisting([candidate], existing)).toHaveLength(1)
  })
})
