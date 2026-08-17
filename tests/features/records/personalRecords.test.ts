/**
 * 个人纪录聚合测试（规格 §39 P2）。
 *
 * 验证：骑行纪录三类取最大与并列保留最早、功率纪录跨活动合并、
 * 无功率数据边界、时长升序输出。
 */
import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import {
  buildPowerRecords,
  buildRideRecords,
  POWER_RECORD_DURATIONS,
  type ActivityPowerCurve,
} from '@/features/records/personalRecords'

/**
 * 生成活动摘要（仅纪录相关字段有效）。
 *
 * @param id 活动 ID
 * @param overrides 覆盖字段
 */
function makeSummary(id: string, overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00.000Z',
    endTime: '2026-08-01T09:00:00.000Z',
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000,
    elevationGain: 200,
    ...overrides,
  } as ActivitySummary
}

describe('buildRideRecords', () => {
  it('空列表返回空数组', () => {
    expect(buildRideRecords([])).toEqual([])
  })

  it('三类纪录各取最大值并记录活动与时间', () => {
    const summaries = [
      makeSummary('a', { distance: 50000, duration: 7200, elevationGain: 300 }),
      makeSummary('b', {
        distance: 80000,
        duration: 5400,
        elevationGain: 900,
        startTime: '2026-08-05T08:00:00.000Z',
      }),
      makeSummary('c', { distance: 30000, duration: 9000, elevationGain: 150 }),
    ]
    const records = buildRideRecords(summaries)

    expect(records).toHaveLength(3)
    expect(records).toContainEqual({
      key: 'distance',
      value: 80000,
      activityId: 'b',
      startTime: '2026-08-05T08:00:00.000Z',
    })
    expect(records).toContainEqual({
      key: 'duration',
      value: 9000,
      activityId: 'c',
      startTime: '2026-08-01T08:00:00.000Z',
    })
    expect(records).toContainEqual({
      key: 'elevationGain',
      value: 900,
      activityId: 'b',
      startTime: '2026-08-05T08:00:00.000Z',
    })
  })

  it('并列时保留最早达成的活动（严格大于才替换）', () => {
    const summaries = [
      makeSummary('first', { distance: 50000 }),
      makeSummary('second', { distance: 50000 }),
    ]
    const records = buildRideRecords(summaries)

    expect(records.find((record) => record.key === 'distance')?.activityId).toBe('first')
  })
})

describe('buildPowerRecords', () => {
  it('空输入返回空数组', () => {
    expect(buildPowerRecords([])).toEqual([])
  })

  it('跨活动合并：每个时长短取各活动最大值', () => {
    const items: ActivityPowerCurve[] = [
      {
        activity: makeSummary('a', { startTime: '2026-08-01T08:00:00.000Z' }),
        curve: [
          { duration: 5, power: 800 },
          { duration: 1200, power: 220 },
        ],
      },
      {
        activity: makeSummary('b', { startTime: '2026-08-03T08:00:00.000Z' }),
        curve: [
          { duration: 5, power: 950 },
          { duration: 1200, power: 210 },
        ],
      },
    ]
    const records = buildPowerRecords(items)

    expect(records).toEqual([
      { duration: 5, power: 950, activityId: 'b', startTime: '2026-08-03T08:00:00.000Z' },
      { duration: 1200, power: 220, activityId: 'a', startTime: '2026-08-01T08:00:00.000Z' },
    ])
  })

  it('功率纪录按时长升序', () => {
    const items: ActivityPowerCurve[] = [
      {
        activity: makeSummary('a'),
        curve: [
          { duration: 1200, power: 250 },
          { duration: 5, power: 900 },
          { duration: 60, power: 500 },
          { duration: 300, power: 350 },
        ],
      },
    ]
    const records = buildPowerRecords(items)

    expect(records.map((record) => record.duration)).toEqual([...POWER_RECORD_DURATIONS])
  })

  it('全部活动均无功率数据时返回空数组', () => {
    const items: ActivityPowerCurve[] = [
      { activity: makeSummary('a'), curve: [] },
      { activity: makeSummary('b'), curve: [] },
    ]
    expect(buildPowerRecords(items)).toEqual([])
  })
})
