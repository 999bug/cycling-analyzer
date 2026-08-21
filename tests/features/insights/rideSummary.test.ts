/**
 * 骑行一句话总结测试（buildRideSummary）。
 *
 * 覆盖：骑行类型推断（长距离/爬坡/功率档位/心率档位/时长兜底）、
 * 总结文案由真实数据拼装（缺失分句省略）、质量档位短语、
 * 距离与时长均缺失时返回 undefined（不伪造）。
 */
import { describe, expect, it } from 'vitest'
import type { Activity } from '@/types/activity'
import { buildRideSummary } from '@/features/insights/rideSummary'

/** 基础活动摘要（各测试按需覆盖字段） */
function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'test-id',
    fileId: 'file-id',
    fileName: 'test.fit',
    fingerprint: 'fp',
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00+08:00',
    endTime: '2026-08-01T10:00:00+08:00',
    duration: 7200,
    elapsedTime: 7300,
    distance: 60000,
    elevationGain: 300,
    ...overrides,
  }
}

describe('buildRideSummary', () => {
  it('基础场景：耐力骑类型 + 距离/时长/爬升/均速分句', () => {
    const summary = buildRideSummary(
      makeActivity({ avgPower: 180, avgSpeed: 8.33 }),
      { ftp: 250 },
    )

    expect(summary).toBeDefined()
    expect(summary?.rideType).toBe('耐力骑')
    expect(summary?.headline).toContain('60.00 km')
    expect(summary?.headline).toContain('2 小时')
    expect(summary?.headline).toContain('爬升 300 米')
    expect(summary?.headline).toContain('均速')
  })

  it('长距离优先于强度档位（≥80km 判长距离）', () => {
    const summary = buildRideSummary(makeActivity({ distance: 100_000 }), { ftp: 250 })

    expect(summary?.rideType).toBe('长距离')
  })

  it('爬坡日：每公里爬升 ≥15 米判爬坡', () => {
    const summary = buildRideSummary(
      makeActivity({ distance: 40_000, elevationGain: 800 }),
      { ftp: 250 },
    )

    expect(summary?.rideType).toBe('爬坡')
  })

  it('无 FTP 时用心率档位推断类型', () => {
    const summary = buildRideSummary(
      makeActivity({ avgHeartRate: 170, normalizedPower: undefined }),
      { maxHeartRate: 190 },
    )

    expect(summary?.rideType).toBe('阈值强度')
  })

  it('无强度依据时按时长兜底（不伪造强度结论）', () => {
    const summary = buildRideSummary(makeActivity({ duration: 7200 }))

    expect(summary?.rideType).toBe('长骑行')
  })

  it('强度档位映射：IF 0.5 为恢复骑、0.98 为高强度', () => {
    const recovery = buildRideSummary(
      makeActivity({ normalizedPower: 120 }),
      { ftp: 240 },
    )
    const hard = buildRideSummary(
      makeActivity({ normalizedPower: 235 }),
      { ftp: 240 },
    )

    expect(recovery?.rideType).toBe('恢复骑')
    expect(hard?.rideType).toBe('高强度')
  })

  it('质量档位短语随分数变化', () => {
    const excellent = buildRideSummary(makeActivity(), { qualityScore: 92 })
    const good = buildRideSummary(makeActivity(), { qualityScore: 75 })
    const none = buildRideSummary(makeActivity(), {})

    expect(excellent?.qualityPhrase).toBe('状态出色')
    expect(good?.qualityPhrase).toBe('表现良好')
    expect(none?.qualityPhrase).toBeUndefined()
  })

  it('缺失分句自动省略：无爬升/无均速时不出现对应分句', () => {
    const summary = buildRideSummary(
      makeActivity({ elevationGain: undefined, avgSpeed: undefined }),
    )

    expect(summary?.headline).not.toContain('爬升')
    expect(summary?.headline).not.toContain('均速')
    expect(summary?.headline).toContain('60.00 km')
  })

  it('英里单位换算生效', () => {
    const summary = buildRideSummary(makeActivity(), { distanceUnit: 'mi' })

    expect(summary?.headline).toContain('mi')
  })

  it('距离与时长均缺失时返回 undefined（不伪造）', () => {
    expect(
      buildRideSummary(makeActivity({ distance: undefined, duration: 0 })),
    ).toBeUndefined()
  })
})
