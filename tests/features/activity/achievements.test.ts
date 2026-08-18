/**
 * 成就检测纯逻辑测试。
 *
 * - 首次骑行（无历史）不产生成就；
 * - 仅与开始时间严格早于本次的活动比较（排除自身与更晚活动）；
 * - 严格大于历史最大才算刷新；
 * - 字段缺失不参评、历史全缺无可比纪录（不伪造）。
 */
import { describe, expect, it } from 'vitest'
import { detectAchievements, type AchievementInput } from '@/features/activity/achievements'

/** 构造活动摘要（仅需成就检测用到的字段） */
function makeActivity(overrides: Partial<AchievementInput> & { id: string }): AchievementInput {
  return {
    startTime: '2025-01-01T00:00:00.000Z',
    distance: 10_000,
    duration: 1800,
    elevationGain: 100,
    avgSpeed: 5.5,
    avgPower: 150,
    ...overrides,
  }
}

const HISTORY: AchievementInput[] = [
  makeActivity({ id: 'a1', startTime: '2025-01-01T00:00:00.000Z', distance: 20_000, duration: 3600, elevationGain: 200, avgSpeed: 6.0, avgPower: 180 }),
  makeActivity({ id: 'a2', startTime: '2025-02-01T00:00:00.000Z', distance: 30_000, duration: 5400, elevationGain: 500, avgSpeed: 6.5, avgPower: 200 }),
]

describe('detectAchievements', () => {
  it('首次骑行（无历史）不产生成就', () => {
    const current = makeActivity({ id: 'a3', startTime: '2025-03-01T00:00:00.000Z' })
    expect(detectAchievements(current, [])).toEqual([])
  })

  it('未刷新任何纪录时返回空数组', () => {
    const current = makeActivity({ id: 'a3', startTime: '2025-03-01T00:00:00.000Z' })
    expect(detectAchievements(current, HISTORY)).toEqual([])
  })

  it('刷新距离纪录：返回最远骑行成就与原纪录', () => {
    const current = makeActivity({ id: 'a3', startTime: '2025-03-01T00:00:00.000Z', distance: 35_000 })
    expect(detectAchievements(current, HISTORY)).toEqual([
      { key: 'distance', label: '最远骑行', value: 35_000, previousBest: 30_000 },
    ])
  })

  it('多维度同时刷新时返回多条成就', () => {
    const current = makeActivity({
      id: 'a3',
      startTime: '2025-03-01T00:00:00.000Z',
      distance: 35_000,
      duration: 6000,
      elevationGain: 600,
      avgSpeed: 7.0,
      avgPower: 220,
    })
    const achievements = detectAchievements(current, HISTORY)
    expect(achievements.map((a) => a.key)).toEqual([
      'distance',
      'duration',
      'elevationGain',
      'avgSpeed',
      'avgPower',
    ])
  })

  it('与历史最大值持平不算刷新（严格大于）', () => {
    const current = makeActivity({ id: 'a3', startTime: '2025-03-01T00:00:00.000Z', distance: 30_000 })
    expect(detectAchievements(current, HISTORY)).toEqual([])
  })

  it('本次某维度缺失时该维度不参评', () => {
    const current = makeActivity({ id: 'a3', startTime: '2025-03-01T00:00:00.000Z', distance: undefined, duration: 6000 })
    const achievements = detectAchievements(current, HISTORY)
    expect(achievements.map((a) => a.key)).toEqual(['duration'])
  })

  it('历史某维度全部缺失时该维度无可比纪录（不算刷新）', () => {
    const history = [
      makeActivity({ id: 'a1', avgPower: undefined }),
      makeActivity({ id: 'a2', startTime: '2025-02-01T00:00:00.000Z', avgPower: undefined }),
    ]
    const current = makeActivity({ id: 'a3', startTime: '2025-03-01T00:00:00.000Z' })
    expect(detectAchievements(current, history)).toEqual([])
  })

  it('更晚开始的活动不参与比较；自身被排除', () => {
    const history = [
      makeActivity({ id: 'a1', distance: 20_000 }),
      // 比本次更晚的活动即使值更大也不算历史纪录
      makeActivity({ id: 'a9', startTime: '2025-06-01T00:00:00.000Z', distance: 99_000 }),
      // 与本次同 ID 的自身记录
      makeActivity({ id: 'a3', startTime: '2025-03-01T00:00:00.000Z', distance: 88_000 }),
    ]
    const current = makeActivity({ id: 'a3', startTime: '2025-03-01T00:00:00.000Z', distance: 25_000 })
    expect(detectAchievements(current, history)).toEqual([
      { key: 'distance', label: '最远骑行', value: 25_000, previousBest: 20_000 },
    ])
  })
})
