/**
 * 统计聚合纯函数测试（规格 §28）。
 *
 * 覆盖：六个范围键的边界（本周一、跨年周、本月 1 号、今年 1 月 1 日、
 * 过去 12 个月起点、自定义含边界日）、自定义无效输入、空数据、
 * 平均值与最大值正确性、未来活动不计入预设范围。
 * 所有时间戳用本地时区构造（new Date(y, m, d)），断言与实现口径一致，
 * 不依赖运行机器的时区。
 */
import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { buildStatistics, resolveRange } from '@/features/statistics/statistics'

/** 固定参考时间：2026-08-17（周一）12:00 本地时间 */
const NOW = new Date(2026, 7, 17, 12)

/**
 * 构造本地时区 ISO 时间戳。
 *
 * @param year 年
 * @param month 月（1-12）
 * @param day 日
 * @param hour 时
 * @param minute 分
 */
function iso(year: number, month: number, day: number, hour = 8, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString()
}

/**
 * 构造测试活动摘要。
 *
 * @param id 活动 ID
 * @param startTime 开始时间（ISO 8601）
 * @param distance 距离（米）
 * @param duration 时长（秒）
 * @param elevationGain 爬升（米）
 */
function summary(
  id: string,
  startTime: string,
  distance = 10000,
  duration = 3600,
  elevationGain = 100,
): ActivitySummary {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime,
    endTime: startTime,
    duration,
    elapsedTime: duration,
    distance,
    elevationGain,
  }
}

describe('resolveRange 范围解析', () => {
  it('本周：起点为本周一 00:00，终点为 now', () => {
    const range = resolveRange('week', NOW)

    expect(range.startMs).toBe(new Date(2026, 7, 17, 0, 0, 0, 0).getTime())
    expect(range.endMs).toBe(NOW.getTime())
  })

  it('跨年周：2026-01-01（周四）的本周一为 2025-12-29', () => {
    const now = new Date(2026, 0, 1, 12)
    const range = resolveRange('week', now)

    expect(range.startMs).toBe(new Date(2025, 11, 29, 0, 0, 0, 0).getTime())
    expect(range.endMs).toBe(now.getTime())
  })

  it('本月：起点为本月 1 号 00:00', () => {
    const range = resolveRange('month', NOW)

    expect(range.startMs).toBe(new Date(2026, 7, 1, 0, 0, 0, 0).getTime())
    expect(range.endMs).toBe(NOW.getTime())
  })

  it('今年：起点为 1 月 1 日 00:00', () => {
    const range = resolveRange('year', NOW)

    expect(range.startMs).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime())
    expect(range.endMs).toBe(NOW.getTime())
  })

  it('过去 12 个月：起点为 12 个月前今天 00:00（跨年窗口）', () => {
    const range = resolveRange('last12Months', NOW)

    expect(range.startMs).toBe(new Date(2025, 7, 17, 0, 0, 0, 0).getTime())
    expect(range.endMs).toBe(NOW.getTime())

    // 跨年窗口：2026-02-15 的起点为 2025-02-15
    const feb = resolveRange('last12Months', new Date(2026, 1, 15, 9))
    expect(feb.startMs).toBe(new Date(2025, 1, 15, 0, 0, 0, 0).getTime())
  })

  it('全部：起点为 epoch，无上界', () => {
    const range = resolveRange('all', NOW)

    expect(range.startMs).toBe(0)
    expect(range.endMs).toBeNull()
  })

  it('自定义：起止日期整天含边界（结束日 24:00 前一毫秒）', () => {
    const range = resolveRange('custom', NOW, { start: '2026-08-01', end: '2026-08-31' })

    expect(range.startMs).toBe(new Date(2026, 7, 1, 0, 0, 0, 0).getTime())
    expect(range.endMs).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime() - 1)
  })

  it('自定义：跨年日期范围正常解析', () => {
    const range = resolveRange('custom', NOW, { start: '2025-12-25', end: '2026-01-05' })

    expect(range.startMs).toBe(new Date(2025, 11, 25, 0, 0, 0, 0).getTime())
    expect(range.endMs).toBe(new Date(2026, 0, 6, 0, 0, 0, 0).getTime() - 1)
  })

  it('自定义：无效输入返回空范围（格式错误/溢出日期/结束早于开始）', () => {
    expect(resolveRange('custom', NOW, { start: '2026/08/01', end: '2026-08-31' })).toEqual({
      startMs: 0,
      endMs: 0,
    })
    expect(resolveRange('custom', NOW, { start: '2026-02-31', end: '2026-08-31' })).toEqual({
      startMs: 0,
      endMs: 0,
    })
    expect(resolveRange('custom', NOW, { start: '2026-08-31', end: '2026-08-01' })).toEqual({
      startMs: 0,
      endMs: 0,
    })
    expect(resolveRange('custom', NOW)).toEqual({ startMs: 0, endMs: 0 })
  })
})

describe('buildStatistics 范围过滤', () => {
  it('本周：周一 00:00 边界活动计入，周日 23:59 不计入', () => {
    const metrics = buildStatistics(
      [
        // 本周一 00:00：正好在边界上，计入
        summary('monday-midnight', iso(2026, 8, 17, 0)),
        // 上周日 23:59：不在本周
        summary('last-sunday', iso(2026, 8, 16, 23, 59)),
      ],
      resolveRange('week', NOW),
    )

    expect(metrics.count).toBe(1)
    expect(metrics.totalDistance).toBe(10000)
  })

  it('跨年周：2025-12-29（本周一）计入，2025-12-28（上周日）不计入', () => {
    const now = new Date(2026, 0, 1, 12)
    const metrics = buildStatistics(
      [
        summary('prev-monday', iso(2025, 12, 29, 8), 50000),
        summary('prev-sunday', iso(2025, 12, 28, 8), 20000),
        summary('new-year', iso(2026, 1, 1, 8), 30000),
      ],
      resolveRange('week', now),
    )

    expect(metrics.count).toBe(2)
    expect(metrics.totalDistance).toBe(80000)
  })

  it('本月：1 号 00:00 计入，上月最后一天不计入', () => {
    const metrics = buildStatistics(
      [
        summary('month-start', iso(2026, 8, 1, 0)),
        summary('prev-month-end', iso(2026, 7, 31, 23, 59)),
        summary('today', iso(2026, 8, 17, 8)),
      ],
      resolveRange('month', NOW),
    )

    expect(metrics.count).toBe(2)
  })

  it('今年：1 月 1 日计入，上年 12 月 31 日不计入', () => {
    const metrics = buildStatistics(
      [
        summary('new-year', iso(2026, 1, 1, 8)),
        summary('prev-year', iso(2025, 12, 31, 23, 59)),
        summary('today', iso(2026, 8, 17, 8)),
      ],
      resolveRange('year', NOW),
    )

    expect(metrics.count).toBe(2)
  })

  it('过去 12 个月：起点当天计入（含边界），起点前一天不计入', () => {
    const metrics = buildStatistics(
      [
        // 12 个月前今天 00:00：正好在边界上，计入
        summary('window-start', iso(2025, 8, 17, 0), 50000),
        // 起点前一天：窗口外
        summary('before-window', iso(2025, 8, 16, 23, 59), 20000),
        summary('today', iso(2026, 8, 17, 8), 30000),
      ],
      resolveRange('last12Months', NOW),
    )

    expect(metrics.count).toBe(2)
    expect(metrics.totalDistance).toBe(80000)
  })

  it('自定义：起始日与结束日整天含边界，边界外不计入', () => {
    const metrics = buildStatistics(
      [
        // 起始日 00:00：计入
        summary('custom-start', iso(2026, 8, 1, 0), 10000),
        // 起始日前一天：不计入
        summary('before-custom', iso(2026, 7, 31, 23, 59), 20000),
        // 结束日 23:59：计入（整天含边界）
        summary('custom-end', iso(2026, 8, 31, 23, 59), 30000),
        // 结束日次日：不计入
        summary('after-custom', iso(2026, 9, 1, 0), 40000),
      ],
      resolveRange('custom', NOW, { start: '2026-08-01', end: '2026-08-31' }),
    )

    expect(metrics.count).toBe(2)
    expect(metrics.totalDistance).toBe(40000)
  })

  it('全部：不设上界，未来活动也计入', () => {
    const metrics = buildStatistics(
      [summary('past', iso(2020, 1, 1, 8)), summary('future', iso(2027, 1, 1, 8))],
      resolveRange('all', NOW),
    )

    expect(metrics.count).toBe(2)
  })

  it('预设范围：now 之后开始的活动不计入', () => {
    const metrics = buildStatistics(
      [summary('future', iso(2026, 8, 18, 8)), summary('today', iso(2026, 8, 17, 8))],
      resolveRange('week', NOW),
    )

    expect(metrics.count).toBe(1)
  })
})

describe('buildStatistics 指标计算', () => {
  it('空数据：计数与累计指标为零，功率缺失为 undefined', () => {
    const metrics = buildStatistics([], resolveRange('all', NOW))

    expect(metrics).toEqual({
      count: 0,
      totalDistance: 0,
      totalDuration: 0,
      totalElevationGain: 0,
      avgRideDistance: 0,
      avgSpeed: 0,
      longestRide: 0,
      maxElevationGain: 0,
      maxSpeed: 0,
      maxPower: undefined,
    })
  })

  it('平均值：平均单次距离 = 总距离/次数，平均速度 = 总距离/总时长', () => {
    const metrics = buildStatistics(
      [
        summary('a', iso(2026, 8, 1, 8), 40000, 7200, 500),
        summary('b', iso(2026, 8, 10, 8), 60000, 10800, 300),
      ],
      resolveRange('custom', NOW, { start: '2026-08-01', end: '2026-08-31' }),
    )

    expect(metrics.count).toBe(2)
    expect(metrics.totalDistance).toBe(100000)
    expect(metrics.totalDuration).toBe(18000)
    expect(metrics.avgRideDistance).toBe(50000)
    expect(metrics.avgSpeed).toBeCloseTo(100000 / 18000, 10)
  })

  it('平均速度：总时长为 0 时返回 0，不除零', () => {
    const metrics = buildStatistics(
      [summary('a', iso(2026, 8, 1, 8), 10000, 0, 100)],
      resolveRange('custom', NOW, { start: '2026-08-01', end: '2026-08-31' }),
    )

    expect(metrics.count).toBe(1)
    expect(metrics.avgRideDistance).toBe(10000)
    expect(metrics.avgSpeed).toBe(0)
  })

  it('最大值：最长骑行/单次最大爬升/最快速度/最高功率取范围内单次最大值', () => {
    const metrics = buildStatistics(
      [
        {
          ...summary('short', iso(2026, 8, 1, 8), 10000, 3600, 100),
          maxSpeed: 12,
          maxPower: 200,
        },
        {
          ...summary('long', iso(2026, 8, 5, 8), 50000, 7200, 400),
          maxSpeed: 15,
          maxPower: 350,
        },
        {
          ...summary('steep', iso(2026, 8, 10, 8), 30000, 5400, 600),
          maxSpeed: 10,
          maxPower: 250,
        },
      ],
      resolveRange('custom', NOW, { start: '2026-08-01', end: '2026-08-31' }),
    )

    expect(metrics.longestRide).toBe(50000)
    expect(metrics.maxElevationGain).toBe(600)
    expect(metrics.maxSpeed).toBe(15)
    expect(metrics.maxPower).toBe(350)
  })

  it('maxSpeed/maxPower 缺失时跳过，仅统计有值的活动', () => {
    const metrics = buildStatistics(
      [
        summary('no-power', iso(2026, 8, 1, 8), 10000, 3600, 100),
        {
          ...summary('with-power', iso(2026, 8, 2, 8), 20000, 3600, 200),
          maxSpeed: 14.5,
          maxPower: 420,
        },
      ],
      resolveRange('custom', NOW, { start: '2026-08-01', end: '2026-08-31' }),
    )

    expect(metrics.maxSpeed).toBe(14.5)
    expect(metrics.maxPower).toBe(420)
  })

  it('范围外活动不参与平均值与最大值计算', () => {
    const metrics = buildStatistics(
      [
        // 范围外：距离更大、速度更快，但不计入
        {
          ...summary('outside', iso(2025, 1, 1, 8), 90000, 3600, 900),
          maxSpeed: 30,
          maxPower: 800,
        },
        summary('inside', iso(2026, 8, 10, 8), 20000, 3600, 200),
      ],
      resolveRange('custom', NOW, { start: '2026-08-01', end: '2026-08-31' }),
    )

    expect(metrics.count).toBe(1)
    expect(metrics.totalDistance).toBe(20000)
    expect(metrics.avgRideDistance).toBe(20000)
    expect(metrics.avgSpeed).toBeCloseTo(20000 / 3600, 10)
    expect(metrics.longestRide).toBe(20000)
    expect(metrics.maxElevationGain).toBe(200)
    expect(metrics.maxSpeed).toBe(0)
    expect(metrics.maxPower).toBeUndefined()
  })

  it('范围内活动均无功率数据时 maxPower 为 undefined（缺失 ≠ 0，规格 §25）', () => {
    const metrics = buildStatistics(
      [
        summary('a', iso(2026, 8, 1, 8), 10000, 3600, 100),
        { ...summary('b', iso(2026, 8, 2, 8), 15000, 3600, 150), maxSpeed: 12 },
      ],
      resolveRange('custom', NOW, { start: '2026-08-01', end: '2026-08-31' }),
    )

    expect(metrics.count).toBe(2)
    expect(metrics.maxSpeed).toBe(12)
    expect(metrics.maxPower).toBeUndefined()
  })

  it('默认 now 参数使用当前时间，正常聚合不抛错', () => {
    const metrics = buildStatistics([summary('a', iso(2026, 8, 17, 8))], resolveRange('all'))

    expect(metrics.count).toBe(1)
    expect(metrics.totalDistance).toBe(10000)
  })
})
