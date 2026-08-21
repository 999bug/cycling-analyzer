/**
 * 仪表盘聚合纯函数测试（规格 §13）。
 *
 * 覆盖：周/月/总归组、跨月/跨年边界、同年首日、闰年序列、
 * 趋势序列长度与补零、同日距离合并、无数据。
 * 所有时间戳用本地时区构造（new Date(y, m, d)），断言与实现口径一致，
 * 不依赖运行机器的时区。
 */
import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { buildDashboardData } from '@/features/dashboard/statistics'

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
 * 本地时区日期键（与实现口径一致：YYYY-MM-DD）。
 *
 * @param year 年
 * @param month 月（1-12）
 * @param day 日
 */
function key(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
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

describe('buildDashboardData 周/月/总归组', () => {
  it('按 startTime 归组本周（周一至今天）/本月（1 号至今天）/总计', () => {
    const data = buildDashboardData(
      [
        // 今天（周一）：本周 + 本月 + 总计
        summary('today', iso(2026, 8, 17, 8), 10000, 3600, 100),
        // 上周日：本月 + 总计，不在本周
        summary('last-sunday', iso(2026, 8, 16, 22), 20000, 1800, 200),
        // 上月底：仅总计
        summary('last-month', iso(2026, 7, 31, 8), 30000, 7200, 300),
        // 本月 1 号：本月 + 总计，不在本周
        summary('month-start', iso(2026, 8, 1, 8), 40000, 5400, 400),
      ],
      NOW,
    )

    expect(data.week).toEqual({
      count: 1,
      totalDistance: 10000,
      totalDuration: 3600,
      totalElevationGain: 100,
    })
    expect(data.month).toEqual({
      count: 3,
      totalDistance: 10000 + 20000 + 40000,
      totalDuration: 3600 + 1800 + 5400,
      totalElevationGain: 100 + 200 + 400,
    })
    expect(data.total).toEqual({
      count: 4,
      totalDistance: 10000 + 20000 + 30000 + 40000,
      totalDuration: 3600 + 1800 + 7200 + 5400,
      totalElevationGain: 100 + 200 + 300 + 400,
    })
    expect(data.hasData).toBe(true)
  })

  it('now 之后开始的活动不计入周/月，仅计入总计', () => {
    const data = buildDashboardData([summary('future', iso(2026, 8, 18, 8))], NOW)

    expect(data.week.count).toBe(0)
    expect(data.month.count).toBe(0)
    expect(data.total.count).toBe(1)
  })

  it('无数据时全部聚合为零且 hasData 为 false', () => {
    const data = buildDashboardData([], NOW)

    expect(data.week).toEqual({ count: 0, totalDistance: 0, totalDuration: 0, totalElevationGain: 0 })
    expect(data.month).toEqual(data.week)
    expect(data.total).toEqual(data.week)
    expect(data.hasData).toBe(false)
    // 趋势序列仍保持完整长度，全部补零
    expect(data.trends.days30).toHaveLength(30)
    expect(data.trends.days90).toHaveLength(90)
    expect(data.trends.year).toHaveLength(365)
    expect(data.trends.days30.every((d) => d.distance === 0)).toBe(true)
  })
})

describe('buildDashboardData 跨年边界', () => {
  it('跨年周/月归组：12 月底活动属于本周（周一 12-29）但不属于 1 月', () => {
    // 2026-01-01 是周四，本周一为 2025-12-29
    const now = new Date(2026, 0, 1, 12)
    const data = buildDashboardData(
      [
        summary('prev-monday', iso(2025, 12, 29, 8), 10000, 3600, 100),
        summary('prev-sunday', iso(2025, 12, 28, 8), 20000, 7200, 200),
        summary('new-year', iso(2026, 1, 1, 8), 30000, 5400, 300),
      ],
      now,
    )

    // 本周一 12-29：12-29 与 1-1 在内，12-28（上周日）不在
    expect(data.week).toEqual({
      count: 2,
      totalDistance: 10000 + 30000,
      totalDuration: 3600 + 5400,
      totalElevationGain: 100 + 300,
    })
    expect(data.month).toEqual({
      count: 1,
      totalDistance: 30000,
      totalDuration: 5400,
      totalElevationGain: 300,
    })
    expect(data.total.count).toBe(3)
  })

  it('30 天序列起点跨年：1 月 1 日的序列从上年 12 月 3 日开始', () => {
    const now = new Date(2026, 0, 1, 12)
    const data = buildDashboardData([summary('xmas', iso(2025, 12, 25, 8), 20000)], now)

    expect(data.trends.days30).toHaveLength(30)
    expect(data.trends.days30[0]).toEqual({ date: key(2025, 12, 3), distance: 0 })
    expect(data.trends.days30[29]).toEqual({ date: key(2026, 1, 1), distance: 0 })
    // 12-25 位于序列第 23 天（12-03 + 22 天）
    expect(data.trends.days30[22]).toEqual({ date: key(2025, 12, 25), distance: 20000 })
    // 跨年年内活动（12-02）落在序列之外
    expect(data.trends.days30.some((d) => d.date === key(2025, 12, 2) && d.distance > 0)).toBe(false)
  })

  it('90 天序列跨年：3 月 1 日（平年 2 月）的序列从上年 12 月 2 日开始', () => {
    const now = new Date(2026, 2, 1, 12)
    const data = buildDashboardData([summary('new-year-eve', iso(2025, 12, 31, 8), 50000)], now)

    expect(data.trends.days90).toHaveLength(90)
    expect(data.trends.days90[0].date).toBe(key(2025, 12, 2))
    expect(data.trends.days90[29]).toEqual({ date: key(2025, 12, 31), distance: 50000 })
    // 序列终点恒为今天
    expect(data.trends.days90[89].date).toBe(key(2026, 3, 1))
  })

  it('一年序列：固定 365 天窗口，起点为终点前 364 天', () => {
    const now = new Date(2026, 0, 1, 12)
    const data = buildDashboardData([], now)

    expect(data.trends.year).toHaveLength(365)
    expect(data.trends.year[0].date).toBe(key(2025, 1, 2))
    expect(data.trends.year[364].date).toBe(key(2026, 1, 1))
  })

  it('一年序列：闰年 2 月 29 日当天仍为 365 天窗口（终点含 2-29）', () => {
    // 2028 为闰年，终点 2028-02-29，起点 = 2028-02-29 前 364 天 = 2027-03-02
    const now = new Date(2028, 1, 29, 12)
    const data = buildDashboardData([], now)

    expect(data.trends.year).toHaveLength(365)
    expect(data.trends.year[0].date).toBe(key(2027, 3, 2))
    expect(data.trends.year[364].date).toBe(key(2028, 2, 29))
  })
})

describe('buildDashboardData 趋势序列归组', () => {
  it('同日多次活动距离合并，不同日分别归组', () => {
    const data = buildDashboardData(
      [
        summary('a1', iso(2026, 8, 17, 8), 50000),
        summary('a2', iso(2026, 8, 17, 19), 30000),
        summary('a3', iso(2026, 8, 16, 8), 40000),
      ],
      NOW,
    )

    // 今天为序列最后一天，昨天为倒数第二天
    expect(data.trends.days30[29]).toEqual({ date: key(2026, 8, 17), distance: 80000 })
    expect(data.trends.days30[28]).toEqual({ date: key(2026, 8, 16), distance: 40000 })
    expect(data.trends.days30[27]).toEqual({ date: key(2026, 8, 15), distance: 0 })
  })

  it('默认 now 参数使用当前时间，正常聚合不抛错', () => {
    const data = buildDashboardData([summary('a', iso(2026, 8, 17, 8))])

    expect(data.hasData).toBe(true)
    expect(data.total.count).toBe(1)
    expect(data.trends.days30).toHaveLength(30)
  })
})

describe('buildDashboardData 最近骑行', () => {
  it('按 startTime 降序截取前 5 条，无效时间戳剔除', () => {
    const rides = [
      summary('oldest', iso(2026, 5, 1, 8)),
      summary('d6', iso(2026, 8, 12, 8)),
      summary('newest', iso(2026, 8, 17, 8)),
      { ...summary('invalid', 'not-a-date') },
      summary('d5', iso(2026, 8, 11, 8)),
      summary('d4', iso(2026, 8, 10, 8)),
      summary('d3', iso(2026, 8, 7, 8)),
      summary('d2', iso(2026, 8, 4, 8)),
      summary('d1', iso(2026, 8, 2, 8)),
    ]

    const data = buildDashboardData(rides, NOW)

    expect(data.recentActivities.map((r) => r.id)).toEqual([
      'newest',
      'd6',
      'd5',
      'd4',
      'd3',
    ])
  })

  it('不足 5 条时全量返回，空数据为空数组', () => {
    const data = buildDashboardData([summary('only', iso(2026, 8, 17, 8))], NOW)
    expect(data.recentActivities.map((r) => r.id)).toEqual(['only'])

    const empty = buildDashboardData([], NOW)
    expect(empty.recentActivities).toEqual([])
  })
})
