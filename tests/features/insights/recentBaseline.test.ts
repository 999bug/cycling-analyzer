/**
 * 历史对比基线测试（buildRecentBaseline）。
 *
 * 验证：样本不足不生成、排除当前活动、按开始时间取最近窗口、
 * 功率均值需足够样本、均值口径正确。
 */
import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import {
  RECENT_BASELINE_MIN_SAMPLES,
  RECENT_BASELINE_WINDOW,
  buildRecentBaseline,
} from '@/features/insights/recentBaseline'

/** 构造活动摘要（仅基线所需字段） */
function makeSummary(overrides: Partial<ActivitySummary> & { id: string }): ActivitySummary {
  return {
    fileId: 'file',
    fileName: 'test.fit',
    fingerprint: `fp-${overrides.id}`,
    activityType: 'cycling',
    startTime: '2026-09-01T08:00:00+08:00',
    endTime: '2026-09-01T10:00:00+08:00',
    duration: 7200,
    elapsedTime: 7300,
    distance: 60000,
    ...overrides,
  } as ActivitySummary
}

describe('buildRecentBaseline 历史对比基线', () => {
  it('有效样本不足下限时返回 undefined', () => {
    const summaries = Array.from({ length: RECENT_BASELINE_MIN_SAMPLES - 1 }, (_, index) =>
      makeSummary({ id: `a${index}`, avgSpeed: 6 }),
    )
    expect(buildRecentBaseline(summaries)).toBeUndefined()
  })

  it('排除当前活动后样本不足时返回 undefined', () => {
    const summaries = Array.from({ length: RECENT_BASELINE_MIN_SAMPLES }, (_, index) =>
      makeSummary({ id: `a${index}`, avgSpeed: 6 }),
    )
    // 排除一个后只剩 4 条
    expect(buildRecentBaseline(summaries, 'a0')).toBeUndefined()
  })

  it('按开始时间取最近窗口并求算术平均（最老的被挤出窗口）', () => {
    const baseMs = Date.UTC(2026, 8, 1, 0, 0, 0)
    const summaries = Array.from({ length: RECENT_BASELINE_WINDOW + 5 }, (_, index) =>
      makeSummary({
        id: `a${index}`,
        // 最老的 5 条均速 10，其余 6 —— 取最近 30 条后均值应为 6
        avgSpeed: index < 5 ? 10 : 6,
        startTime: new Date(baseMs + index * 60_000).toISOString(),
      }),
    )
    const baseline = buildRecentBaseline(summaries)
    expect(baseline).toBeDefined()
    expect(baseline?.sampleCount).toBe(RECENT_BASELINE_WINDOW)
    expect(baseline?.avgSpeed).toBeCloseTo(6, 5)
  })

  it('均速缺失的活动不参与统计', () => {
    const summaries = [
      makeSummary({ id: 'a0', avgSpeed: 6 }),
      makeSummary({ id: 'a1', avgSpeed: undefined }),
      makeSummary({ id: 'a2', avgSpeed: 8 }),
      makeSummary({ id: 'a3', avgSpeed: 6 }),
      makeSummary({ id: 'a4', avgSpeed: 4 }),
      makeSummary({ id: 'a5', avgSpeed: 6 }),
    ]
    const baseline = buildRecentBaseline(summaries)
    expect(baseline?.sampleCount).toBe(5)
    expect(baseline?.avgSpeed).toBeCloseTo(6, 5)
  })

  it('功率样本充足时提供功率均值，不足时缺省', () => {
    const summaries = Array.from({ length: RECENT_BASELINE_MIN_SAMPLES }, (_, index) =>
      makeSummary({ id: `a${index}`, avgSpeed: 6, avgPower: 200 }),
    )
    const baseline = buildRecentBaseline(summaries)
    expect(baseline?.avgPower).toBe(200)

    const thinPower = summaries.map((summary, index) =>
      index < 2 ? summary : { ...summary, avgPower: undefined },
    )
    expect(buildRecentBaseline(thinPower)?.avgPower).toBeUndefined()
  })
})
