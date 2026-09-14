/**
 * 赛段成就摘要纯函数测试（二期）。
 */
import { describe, expect, it } from 'vitest'
import { computeSegmentAchievements } from '@/features/segments/segmentStats'
import type { SegmentEffort } from '@/features/segments/segmentMatching'

/** 相对当前时间的 ISO 时间 */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function effort(activityId: string, startTime: string, durationSeconds: number): SegmentEffort {
  return { activityId, startTime, durationSeconds }
}

describe('computeSegmentAchievements', () => {
  it('统计纪录赛段数、前三成绩数与近 90 天当地传奇', () => {
    const boards = new Map<number, SegmentEffort[]>([
      // 赛段 1：3 次成绩（全部近 90 天）→ 前三 +3，传奇候选 3 次
      [
        1,
        [
          effort('a', daysAgoIso(10), 600),
          effort('b', daysAgoIso(20), 620),
          effort('c', daysAgoIso(30), 640),
        ],
      ],
      // 赛段 2：2 次成绩（一近一远）→ 前三 +2，传奇候选 1 次
      [2, [effort('d', daysAgoIso(5), 500), effort('e', daysAgoIso(200), 520)]],
    ])

    const result = computeSegmentAchievements(boards)
    expect(result.recordSegments).toBe(2)
    expect(result.podiumEfforts).toBe(5)
    expect(result.legend).toEqual({ segmentId: 1, count: 3 })
  })

  it('超过 3 条成绩时前三只计前 3', () => {
    const boards = new Map<number, SegmentEffort[]>([
      [
        1,
        [
          effort('a', daysAgoIso(1), 600),
          effort('b', daysAgoIso(2), 610),
          effort('c', daysAgoIso(3), 620),
          effort('d', daysAgoIso(4), 630),
          effort('e', daysAgoIso(5), 640),
        ],
      ],
    ])
    expect(computeSegmentAchievements(boards).podiumEfforts).toBe(3)
  })

  it('近 90 天无成绩时不产生传奇（旧成绩不计入）', () => {
    const boards = new Map<number, SegmentEffort[]>([
      [1, [effort('a', daysAgoIso(120), 600)]],
      [2, [effort('b', daysAgoIso(150), 500)]],
    ])
    const result = computeSegmentAchievements(boards)
    expect(result.recordSegments).toBe(2)
    expect(result.legend).toBeNull()
  })

  it('空榜单全部归零', () => {
    const result = computeSegmentAchievements(new Map())
    expect(result.recordSegments).toBe(0)
    expect(result.podiumEfforts).toBe(0)
    expect(result.legend).toBeNull()
  })
})
