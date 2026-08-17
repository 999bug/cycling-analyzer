/**
 * 年度回顾纯函数测试（后续工作项：年度回顾）。
 *
 * 验证年份提取（降序/去重/无效时间剔除）、月度聚合（12 月齐全/按年过滤）、
 * 年度范围构造（含边界日）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildMonthlyDistances,
  extractYears,
  yearRange,
} from '@/features/yearReview/yearReview'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/**
 * 构造摘要（仅测试所需字段）。
 *
 * @param startTime 开始时间（ISO 8601）
 * @param distance 距离（米）
 */
function makeSummary(startTime: string, distance = 10000): ActivitySummary {
  return {
    id: `act-${startTime}`,
    fileId: 'file-1',
    fileName: 'ride.fit',
    fingerprint: `fp-${startTime}`,
    activityType: 'cycling',
    startTime,
    endTime: startTime,
    duration: 3600,
    elapsedTime: 3600,
    distance,
    elevationGain: 100,
  }
}

describe('extractYears', () => {
  it('提取有数据的年份并降序去重', () => {
    const years = extractYears([
      makeSummary('2024-05-01T08:00:00'),
      makeSummary('2026-01-01T08:00:00'),
      makeSummary('2026-08-01T08:00:00'),
      makeSummary('2025-06-15T08:00:00'),
    ])
    expect(years).toEqual([2026, 2025, 2024])
  })

  it('无效时间剔除，空数据返回空数组', () => {
    expect(extractYears([makeSummary('not-a-date')])).toEqual([])
    expect(extractYears([])).toEqual([])
  })
})

describe('buildMonthlyDistances', () => {
  it('按年聚合月度距离/次数，无数据月为 0', () => {
    const months = buildMonthlyDistances(
      [
        makeSummary('2026-01-10T08:00:00', 10000),
        makeSummary('2026-01-20T08:00:00', 20000),
        makeSummary('2026-08-01T08:00:00', 50000),
        // 其他年份不计入
        makeSummary('2025-01-10T08:00:00', 99000),
      ],
      2026,
    )

    expect(months).toHaveLength(12)
    expect(months[0]).toEqual({ month: 1, distance: 30000, count: 2 })
    expect(months[7]).toEqual({ month: 8, distance: 50000, count: 1 })
    expect(months[11]).toEqual({ month: 12, distance: 0, count: 0 })
  })

  it('无效时间剔除', () => {
    const months = buildMonthlyDistances([makeSummary('bad')], 2026)
    expect(months.every((entry) => entry.count === 0)).toBe(true)
  })
})

describe('yearRange', () => {
  it('构造含边界日的自然年范围', () => {
    expect(yearRange(2026)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })
})
