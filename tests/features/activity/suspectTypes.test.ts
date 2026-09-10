/**
 * 存量活动类型复核检测测试。
 */
import { describe, expect, it } from 'vitest'
import {
  defaultSelectedIds,
  detectTypeSuspects,
  isGreySuspect,
  summarizeTypeFixImpact,
} from '@/features/activity/suspectTypes'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/**
 * 构造最小摘要：由距离（km）与均速（km/h）推演出 duration（秒）。
 *
 * @param id 活动 ID
 * @param activityType 当前记录的类型
 * @param distanceKm 距离（公里）
 * @param speedKmh 平均速度（km/h）
 * @param startTime 开始时间（ISO，用于排序断言）
 */
function makeSummary(
  id: string,
  activityType: string,
  distanceKm: number,
  speedKmh: number,
  startTime = '2026-08-01T10:00:00.000Z',
): ActivitySummary {
  const distance = distanceKm * 1000
  const avgSpeed = speedKmh / 3.6
  return {
    id,
    activityType,
    distance,
    duration: Math.round(distance / avgSpeed),
    avgSpeed,
    startTime,
  } as ActivitySummary
}

describe('detectTypeSuspects 记为骑行但实际疑似非骑行', () => {
  it('慢速轨迹判步行（旧版 GPX 默认 cycling 导致散步被计入骑行）', () => {
    const suspects = detectTypeSuspects([makeSummary('a', 'cycling', 2.1, 4.3)])

    expect(suspects).toHaveLength(1)
    expect(suspects[0].suggestedType).toBe('walking')
    expect(suspects[0].confidence).toBe('high')
    expect(suspects[0].basis).toContain('均速 4.3 km/h')
  })

  it('短距离跑步节奏判跑步（medium，默认勾选）', () => {
    const suspects = detectTypeSuspects([makeSummary('a', 'cycling', 5.2, 9.8)])

    expect(suspects).toHaveLength(1)
    expect(suspects[0].suggestedType).toBe('running')
    expect(suspects[0].confidence).toBe('medium')
    expect(isGreySuspect(suspects[0])).toBe(false)
  })

  it('城市通勤速度落入灰区：仍列出但标注需确认', () => {
    const suspects = detectTypeSuspects([makeSummary('a', 'cycling', 12.4, 13.2)])

    expect(suspects).toHaveLength(1)
    expect(isGreySuspect(suspects[0])).toBe(true)
    expect(suspects[0].basis).toContain('重叠区')
  })

  it('正常骑行速度不产生候选（避免清单被误报淹没）', () => {
    const suspects = detectTypeSuspects([
      makeSummary('a', 'cycling', 40, 25.6),
      makeSummary('b', 'cycling', 5.1, 18.94),
    ])

    expect(suspects.map((s) => s.summary.id)).toEqual(['b'])
    expect(isGreySuspect(suspects[0])).toBe(true)
  })

  it('长距离低速仍视为骑行（负重长途），不误判', () => {
    expect(detectTypeSuspects([makeSummary('a', 'cycling', 100, 9)])).toHaveLength(0)
  })

  it('历史遗留写法 road_biking / 骑行 同样参与检测', () => {
    const suspects = detectTypeSuspects([
      makeSummary('a', 'road_biking', 2.1, 4.3),
      makeSummary('b', '骑行', 3.0, 5.0),
    ])

    expect(suspects.map((s) => s.summary.id).sort()).toEqual(['a', 'b'])
  })
})

describe('detectTypeSuspects 归入「其他」但明确是骑行', () => {
  it('高速特征提示改回骑行（避免真骑行从统计里消失）', () => {
    const suspects = detectTypeSuspects([makeSummary('a', 'other', 40, 25.6)])

    expect(suspects).toHaveLength(1)
    expect(suspects[0].suggestedType).toBe('cycling')
    expect(suspects[0].confidence).toBe('high')
  })

  it('灰区速度的「其他」不提示（划船/滑雪等无关活动不该被列为候选）', () => {
    expect(detectTypeSuspects([makeSummary('a', 'other', 12.4, 13.2)])).toHaveLength(0)
  })

  it('本身就是非骑行的活动不参与（类型已经正确）', () => {
    expect(detectTypeSuspects([makeSummary('a', 'running', 5.2, 9.8)])).toHaveLength(0)
    expect(detectTypeSuspects([makeSummary('a', 'walking', 2.1, 4.3)])).toHaveLength(0)
  })
})

describe('detectTypeSuspects 排序', () => {
  it('按开始时间倒序，与列表页一致', () => {
    const suspects = detectTypeSuspects([
      makeSummary('old', 'cycling', 2.1, 4.3, '2026-07-01T10:00:00.000Z'),
      makeSummary('new', 'cycling', 3.0, 4.5, '2026-09-01T10:00:00.000Z'),
      makeSummary('mid', 'cycling', 2.5, 4.4, '2026-08-01T10:00:00.000Z'),
    ])

    expect(suspects.map((s) => s.summary.id)).toEqual(['new', 'mid', 'old'])
  })
})

describe('defaultSelectedIds', () => {
  it('高/中置信默认勾选，灰区默认不勾', () => {
    const suspects = detectTypeSuspects([
      makeSummary('walk', 'cycling', 2.1, 4.3),
      makeSummary('run', 'cycling', 5.2, 9.8),
      makeSummary('grey', 'cycling', 12.4, 13.2),
    ])

    expect([...defaultSelectedIds(suspects)].sort()).toEqual(['run', 'walk'])
  })
})

describe('summarizeTypeFixImpact', () => {
  const all = [
    makeSummary('ride-1', 'cycling', 40, 25.6),
    makeSummary('ride-2', 'cycling', 20, 24),
    makeSummary('run-1', 'cycling', 5.2, 9.8),
    makeSummary('walk-1', 'cycling', 2.1, 4.3),
  ]

  it('勾选把活动移出骑行口径：里程与次数同步减少', () => {
    const suspects = detectTypeSuspects(all)
    const selected = new Set(['run-1', 'walk-1'])

    const impact = summarizeTypeFixImpact(all, suspects, selected)

    expect(impact.beforeCount).toBe(4)
    expect(impact.afterCount).toBe(2)
    expect(impact.beforeDistance).toBe(67_300)
    expect(impact.afterDistance).toBe(60_000)
  })

  it('取消勾选则保留在骑行口径内', () => {
    const suspects = detectTypeSuspects(all)

    const impact = summarizeTypeFixImpact(all, suspects, new Set())

    expect(impact.afterCount).toBe(impact.beforeCount)
    expect(impact.afterDistance).toBe(impact.beforeDistance)
  })

  it('勾选「其他 → 骑行」会让该条重新计入骑行口径（里程与次数增加）', () => {
    const withOther = [...all, makeSummary('ghost', 'other', 40, 25.6)]
    const suspects = detectTypeSuspects(withOther)
    const ghost = suspects.find((s) => s.summary.id === 'ghost')

    expect(ghost).toBeDefined()
    const impact = summarizeTypeFixImpact(withOther, suspects, new Set(['ghost']))

    // 「其他」原本不计入骑行口径，改回骑行后 +1 次 +40km
    expect(impact.beforeCount).toBe(4)
    expect(impact.afterCount).toBe(5)
    expect(impact.afterDistance - impact.beforeDistance).toBe(40_000)
  })
})
