/**
 * 骑行统计口径测试：非骑行活动不得进入骑行语义页面的取数。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  filterCycling,
  getIncludeOtherSports,
  listCyclingSummaries,
  resetCyclingScopeForTest,
} from '@/features/activity/cyclingScope'
import type {
  ActivityReadRepository,
  ActivitySummary,
} from '@/storage/repositories/activityRepository'

/** 构造最小摘要（仅关注 activityType） */
function summary(id: string, activityType: string): ActivitySummary {
  return { id, activityType } as ActivitySummary
}

/** 只实现 listAllSummaries 的假仓库 */
function fakeRepository(items: ActivitySummary[]): ActivityReadRepository {
  return {
    listAllSummaries: async () => items,
  } as unknown as ActivityReadRepository
}

afterEach(() => {
  resetCyclingScopeForTest()
})

describe('filterCycling', () => {
  it('默认只保留骑行，跑步/步行/徒步被排除', () => {
    const items = [
      summary('1', 'cycling'),
      summary('2', 'running'),
      summary('3', 'walking'),
      summary('4', 'hiking'),
      summary('5', 'other'),
    ]

    expect(filterCycling(items).map((a) => a.id)).toEqual(['1'])
  })

  it('对库中历史遗留写法同样识别为骑行（佳明 road_biking / Strava 中文）', () => {
    const items = [summary('1', 'road_biking'), summary('2', '骑行'), summary('3', 'Ride')]

    expect(filterCycling(items).map((a) => a.id)).toEqual(['1', '2', '3'])
  })

  it('开启「统计包含其他运动」后原样返回（不修改入参）', () => {
    const items = [summary('1', 'cycling'), summary('2', 'running')]
    resetCyclingScopeForTest(true)

    const result = filterCycling(items)
    expect(result.map((a) => a.id)).toEqual(['1', '2'])
    expect(result).not.toBe(items)
    expect(getIncludeOtherSports()).toBe(true)
  })
})

describe('listCyclingSummaries', () => {
  it('从仓库取全量后按骑行口径过滤（供 scanKey 直接使用）', async () => {
    const repository = fakeRepository([
      summary('1', 'cycling'),
      summary('2', 'running'),
      summary('3', 'cycling'),
    ])

    const result = await listCyclingSummaries(repository)

    expect(result.map((a) => a.id)).toEqual(['1', '3'])
  })

  it('开关开启时返回仓库全量', async () => {
    const repository = fakeRepository([summary('1', 'cycling'), summary('2', 'running')])
    resetCyclingScopeForTest(true)

    const result = await listCyclingSummaries(repository)

    expect(result).toHaveLength(2)
  })
})
