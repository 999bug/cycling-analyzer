/**
 * 匹配的骑行（Similar Rides）查找测试。
 *
 * findMatchingRides：返回与指定活动同一路线分组的其他骑行（排除自身、时间降序）；
 * 不在任何分组 / 组内仅自身 / 分组数据为空 → 空数组。
 */
import { describe, expect, it } from 'vitest'
import { findMatchingRides } from '@/features/routes/similarRides'
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
