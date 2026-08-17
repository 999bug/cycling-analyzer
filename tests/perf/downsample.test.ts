/**
 * 图表抽稀与扫描缓存键测试（性能优化，任务 #18）。
 *
 * downsampleRecords：未超上限原样返回、超上限等距抽稀保首尾；
 * summariesScanKey：数量/总距离/最新时间任一变化即变键。
 */
import { describe, expect, it } from 'vitest'
import { downsampleRecords, MAX_CHART_POINTS } from '@/charts/downsample'
import { summariesScanKey } from '@/storage/scanCache'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

describe('downsampleRecords', () => {
  it('未超上限原样返回（浅拷贝）', () => {
    const input = [1, 2, 3]
    const output = downsampleRecords(input)
    expect(output).toEqual([1, 2, 3])
    expect(output).not.toBe(input)
  })

  it('超上限抽稀到指定点数，保留首尾且近似等距', () => {
    const input = Array.from({ length: 5000 }, (_, index) => index)
    const output = downsampleRecords(input, 100)

    expect(output).toHaveLength(100)
    expect(output[0]).toBe(0)
    expect(output[99]).toBe(4999)
    // 近似等距：取样间隔 4999/99 ≈ 50.5，取整后相邻间隔差 ≤ 1
    const gaps = output.slice(1).map((value, index) => value - output[index])
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
  })

  it('默认上限 1000', () => {
    const input = Array.from({ length: 20_000 }, (_, index) => index)
    expect(downsampleRecords(input)).toHaveLength(MAX_CHART_POINTS)
    expect(MAX_CHART_POINTS).toBe(1000)
  })
})

describe('summariesScanKey', () => {
  /** 构造摘要（仅测试所需字段） */
  function makeSummary(id: string, startTime: string, distance: number): ActivitySummary {
    return {
      id,
      fileId: `file-${id}`,
      fileName: `${id}.fit`,
      fingerprint: `fp-${id}`,
      activityType: 'cycling',
      startTime,
      endTime: startTime,
      duration: 3600,
      elapsedTime: 3600,
      distance,
      elevationGain: 0,
    }
  }

  it('相同集合键相同；新增/删除/改距离/改最新时间均变键', () => {
    const base = [
      makeSummary('a', '2026-08-01T08:00:00', 10000),
      makeSummary('b', '2026-08-03T08:00:00', 20000),
    ]
    const same = [...base].reverse()
    expect(summariesScanKey(base)).toBe(summariesScanKey(same))

    // 新增活动
    expect(summariesScanKey([...base, makeSummary('c', '2026-08-02T08:00:00', 5000)])).not.toBe(
      summariesScanKey(base),
    )
    // 删除活动
    expect(summariesScanKey([base[0]])).not.toBe(summariesScanKey(base))
    // 距离变化（同数量同最新时间）
    expect(
      summariesScanKey([base[0], makeSummary('b', '2026-08-03T08:00:00', 21000)]),
    ).not.toBe(summariesScanKey(base))
    // 最新时间变化
    expect(
      summariesScanKey([base[0], makeSummary('b', '2026-08-04T08:00:00', 20000)]),
    ).not.toBe(summariesScanKey(base))
  })

  it('空集合返回固定键', () => {
    expect(summariesScanKey([])).toBe('0|0|')
  })
})
