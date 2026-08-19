/**
 * 匹配的骑行（Similar Rides）查找测试。
 *
 * findMatchingRides：返回与指定活动同一路线分组的其他骑行（排除自身、时间降序）；
 * 不在任何分组 / 组内仅自身 / 分组数据为空 → 空数组。
 */
import { describe, expect, it } from 'vitest'
import { compareDurations, findMatchingRides, trackToSvgPoints } from '@/features/routes/similarRides'
import type { RouteGroup } from '@/features/routes/routeGrouping'

/** 构造一条路线分组（3 个成员，时间升序） */
function makeGroup(ids: string[]): RouteGroup {
  return {
    activities: ids.map((id, index) => ({
      id,
      name: `骑行-${id}`,
      startTime: `2026-08-0${index + 1}T08:00:00`,
      distance: 20000,
      duration: 3600,
    })),
    count: ids.length,
    avgDistance: 20000,
    bestDuration: 3600,
    lastRideTime: '2026-08-03T08:00:00',
    lastActivityId: ids[ids.length - 1] ?? '',
  }
}

describe('findMatchingRides 匹配的骑行', () => {
  it('返回同组其他骑行（排除自身，按时间降序）', () => {
    const groups = [makeGroup(['a1', 'a2', 'a3'])]

    const matches = findMatchingRides(groups, 'a2')

    expect(matches.map((ride) => ride.id)).toEqual(['a3', 'a1'])
    expect(matches[0]).toMatchObject({ name: '骑行-a3', distance: 20000, duration: 3600 })
  })

  it('当前活动不在任何分组时返回空数组', () => {
    const groups = [makeGroup(['a1', 'a2'])]

    expect(findMatchingRides(groups, 'b1')).toEqual([])
  })

  it('组内仅自身时返回空数组（独一路线无匹配）', () => {
    const groups = [makeGroup(['a1'])]

    expect(findMatchingRides(groups, 'a1')).toEqual([])
  })

  it('分组数据为空时返回空数组', () => {
    expect(findMatchingRides(null, 'a1')).toEqual([])
    expect(findMatchingRides([], 'a1')).toEqual([])
  })
})

describe('trackToSvgPoints 迷你轨迹折线', () => {
  it('两点轨迹映射到视口边界', () => {
    // 西南角 → 东北角：应铺满视口
    const points = trackToSvgPoints(
      [
        [30.0, 120.0],
        [31.0, 121.0],
      ],
      120,
      64,
    )
    expect(points).toBe('0.0,64.0 120.0,0.0')
  })

  it('纬度向上（南低北高）；经度无变化时 x 居中为 0', () => {
    // 纬度从 30 → 31：y 从 50 → 0（向上）；经度相同 → x = 0
    const points = trackToSvgPoints(
      [
        [30.0, 120.5],
        [31.0, 120.5],
      ],
      100,
      50,
    )
    expect(points).toBe('0.0,50.0 0.0,0.0')
  })

  it('单点或空轨迹返回空字符串', () => {
    expect(trackToSvgPoints([], 100, 50)).toBe('')
    expect(trackToSvgPoints([[30.0, 120.0]], 100, 50)).toBe('')
  })
})

describe('compareDurations 与本次竞速', () => {
  it('对方更快返回 faster + 差值', () => {
    // 本次 3600s，对方 3500s → 快 100s
    expect(compareDurations(3600, 3500)).toEqual({ faster: true, diffSeconds: 100 })
  })

  it('对方更慢返回 faster false + 差值', () => {
    expect(compareDurations(3600, 3700)).toEqual({ faster: false, diffSeconds: 100 })
  })

  it('用时相等返回持平', () => {
    expect(compareDurations(3600, 3600)).toEqual({ faster: null, diffSeconds: 0 })
  })

  it('当前用时缺失时不比较', () => {
    expect(compareDurations(undefined, 3500)).toBeNull()
    expect(compareDurations(3600, undefined)).toBeNull()
  })
})
