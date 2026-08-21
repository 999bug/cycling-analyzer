/**
 * 日历聚合纯函数测试（规格 §29）。
 *
 * 覆盖：同日多活动合并、不同日分别归组、时区边界（本地日界归组）、
 * 跨年网格边缘、未来活动排除、空数据、颜色档位阈值、工具提示格式。
 * 时间戳用本地时区构造（new Date(y, m, d, h)），断言与实现口径一致，
 * 不依赖运行机器的时区。
 */
import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import {
  buildCalendarData,
  buildMonthLabels,
  buildYearGrid,
  buildYearSummary,
  formatDayTooltip,
  intensityLevel,
} from '@/features/calendar/calendarData'

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
 * 本地时区日期键（Date → YYYY-MM-DD）。
 *
 * @param date 日期
 */
function localKeyOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
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

describe('buildCalendarData 每日归组', () => {
  it('同日多活动合并累加，不同日分别归组', () => {
    const data = buildCalendarData(
      [
        // 同日两次活动（均早于 now 12:00），合并累加
        summary('a1', iso(2026, 8, 17, 8), 50000, 5400, 300),
        summary('a2', iso(2026, 8, 17, 10), 30000, 7200, 200),
        summary('a3', iso(2026, 8, 16, 8), 40000, 3600, 100),
      ],
      NOW,
    )

    expect(data.get(key(2026, 8, 17))).toEqual({
      count: 2,
      distance: 80000,
      duration: 12600,
      elevationGain: 500,
    })
    expect(data.get(key(2026, 8, 16))).toEqual({
      count: 1,
      distance: 40000,
      duration: 3600,
      elevationGain: 100,
    })
  })

  it('时区边界：以本地日界归组，本地 00:30 与前一天 23:59 属于不同日', () => {
    const data = buildCalendarData(
      [
        summary('after-midnight', iso(2026, 8, 17, 0, 30), 10000),
        summary('before-midnight', iso(2026, 8, 16, 23, 59), 20000),
      ],
      NOW,
    )

    expect(data.get(key(2026, 8, 17))?.distance).toBe(10000)
    expect(data.get(key(2026, 8, 16))?.distance).toBe(20000)
    expect(data.size).toBe(2)
  })

  it('跨年：12 月末活动归组到上一年度日期键', () => {
    const now = new Date(2026, 0, 1, 12)
    const data = buildCalendarData([summary('nye', iso(2025, 12, 31, 23, 30), 20000)], now)

    expect(data.get(key(2025, 12, 31))?.count).toBe(1)
    expect(data.size).toBe(1)
  })

  it('now 之后开始的活动不计入聚合', () => {
    const data = buildCalendarData([summary('future', iso(2026, 8, 18, 8))], NOW)

    expect(data.size).toBe(0)
  })

  it('空数据返回空 Map', () => {
    expect(buildCalendarData([], NOW).size).toBe(0)
  })
})

describe('buildYearGrid 年网格', () => {
  it('首行从 1 月 1 日所在周的周日开始，末行覆盖 12 月 31 日所在周', () => {
    const grid = buildYearGrid(2026, new Map())

    // 首格 = 1 月 1 日所在周的周日（1-1 周四 → 2025-12-28，属于上一年）
    const jan1 = new Date(2026, 0, 1)
    const firstCell = new Date(2026, 0, 1 - jan1.getDay())
    expect(grid[0][0].dateKey).toBe(localKeyOf(firstCell))
    expect(grid[0][0].inYear).toBe(false)

    // 每行 7 格（周日起始）
    expect(grid.every((row) => row.length === 7)).toBe(true)

    // 末行包含 12-31（属于当年）与次年 1 月日期（不属于）
    const lastRow = grid[grid.length - 1]
    const dec31 = lastRow.find((cell) => cell.dateKey === key(2026, 12, 31))
    expect(dec31?.inYear).toBe(true)
    expect(lastRow.some((cell) => cell.dateKey === key(2027, 1, 1) && !cell.inYear)).toBe(true)
  })

  it('行数为覆盖天数除以 7（含跨年边缘的完整周）', () => {
    const grid = buildYearGrid(2026, new Map())
    const jan1 = new Date(2026, 0, 1)
    const dec31 = new Date(2026, 11, 31)
    const first = new Date(2026, 0, 1 - jan1.getDay())
    const last = new Date(2026, 11, 31 + (6 - dec31.getDay()))
    // 用 UTC 分量计算天数，避开本地时区 DST 影响
    const days =
      Math.round(
        (Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
          Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) /
          86_400_000,
      ) + 1

    expect(grid.length).toBe(days / 7)
    expect(grid.flat()).toHaveLength(days)
  })

  it('有活动的日期找到对应单元格且携带聚合，无活动日期 summary 为 null', () => {
    const data = buildCalendarData([summary('a', iso(2026, 8, 17, 8), 50000)], NOW)
    const grid = buildYearGrid(2026, data)

    const cell = grid.flat().find((item) => item.dateKey === key(2026, 8, 17))
    expect(cell?.inYear).toBe(true)
    expect(cell?.summary).toEqual({ count: 1, distance: 50000, duration: 3600, elevationGain: 100 })

    const empty = grid.flat().find((item) => item.dateKey === key(2026, 8, 16))
    expect(empty?.summary).toBeNull()
  })
})

describe('intensityLevel 颜色档位', () => {
  it('按 0 / <20km / <50km / <100km / ≥100km 五档', () => {
    expect(intensityLevel(0)).toBe(0)
    expect(intensityLevel(19_999)).toBe(1)
    expect(intensityLevel(20_000)).toBe(2)
    expect(intensityLevel(49_999)).toBe(2)
    expect(intensityLevel(50_000)).toBe(3)
    expect(intensityLevel(99_999)).toBe(3)
    expect(intensityLevel(100_000)).toBe(4)
    expect(intensityLevel(127_400)).toBe(4)
  })
})

describe('formatDayTooltip 工具提示', () => {
  it('拼接日期/次数/距离/时长/爬升（复用 utils/format 格式化）', () => {
    const text = formatDayTooltip('2026-08-16', {
      count: 2,
      distance: 127_400,
      duration: 16_320,
      elevationGain: 1_245,
    })

    expect(text).toBe('2026-08-16 / 2 次骑行 / 127.40 km / 04:32:00 / +1245 m')
  })
})

describe('buildMonthLabels 月份标签', () => {
  it('一年 12 个标签，定位到每月 1 日所在周', () => {
    const grid = buildYearGrid(2026, new Map())
    const labels = buildMonthLabels(grid)
    expect(labels).toHaveLength(12)
    // 2026-01-01（周四）在首周 → 1月 在第 0 周
    expect(labels[0]).toEqual({ weekIndex: 0, label: '1月' })
    // 2026-02-01 是周日，恰为新一周起点：距首周周日 2025-12-28 共 35 天 → 第 5 周
    expect(labels[1]).toEqual({ weekIndex: 5, label: '2月' })
    // 标签月份递增 1..12，周下标严格递增
    expect(labels.map((label) => label.label)).toEqual(
      Array.from({ length: 12 }, (_, index) => `${index + 1}月`),
    )
    for (let index = 1; index < labels.length; index++) {
      expect(labels[index].weekIndex).toBeGreaterThan(labels[index - 1].weekIndex)
    }
  })
})

describe('buildYearSummary 年度汇总', () => {
  it('汇总指定年份：骑行天数/次数/距离/时长/爬升/最长单日', () => {
    const data = buildCalendarData(
      [
        summary('a1', iso(2026, 3, 10), 60_000, 7200, 400),
        summary('a2', iso(2026, 3, 12), 120_000, 14_400, 1_000),
        summary('a3', iso(2026, 3, 12), 30_000, 3_600, 200),
        // 次年活动不计入 2026 汇总
        summary('a4', iso(2025, 5, 1), 99_999, 9_999, 999),
      ],
      NOW,
    )

    expect(buildYearSummary(2026, data)).toEqual({
      rideDays: 2,
      count: 3,
      distance: 210_000,
      duration: 25_200,
      elevationGain: 1_600,
      longestDayDistance: 150_000,
    })
  })

  it('无活动年份返回全零汇总', () => {
    expect(buildYearSummary(2024, new Map())).toEqual({
      rideDays: 0,
      count: 0,
      distance: 0,
      duration: 0,
      elevationGain: 0,
      longestDayDistance: 0,
    })
  })
})
