/**
 * 格式化工具测试：覆盖正常值、边界（0/小数/大值）与无效输入（null/undefined/NaN）。
 * 日期断言固定 UTC 时区（beforeAll 设置、afterAll 恢复，避免污染共享进程影响其他测试文件）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatDate, formatDistance, formatDuration, formatElevation, formatSpeed } from '@/utils/format'

const ORIGINAL_TZ = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'UTC'
})

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

describe('formatDistance', () => {
  it('>= 1000 米显示 2 位小数千米', () => {
    expect(formatDistance(82310)).toBe('82.31 km')
    expect(formatDistance(1000)).toBe('1.00 km')
    expect(formatDistance(500000)).toBe('500.00 km')
  })

  it('< 1000 米显示整数米', () => {
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(999)).toBe('999 m')
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(999.6)).toBe('1000 m')
  })

  it('无效输入返回占位符', () => {
    expect(formatDistance(undefined)).toBe('—')
    expect(formatDistance(null)).toBe('—')
    expect(formatDistance(NaN)).toBe('—')
    expect(formatDistance(Infinity)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('按 H:MM:SS 格式化', () => {
    expect(formatDuration(0)).toBe('00:00:00')
    expect(formatDuration(1)).toBe('00:00:01')
    expect(formatDuration(59)).toBe('00:00:59')
    expect(formatDuration(60)).toBe('00:01:00')
    expect(formatDuration(3600)).toBe('01:00:00')
    expect(formatDuration(5400)).toBe('01:30:00')
    expect(formatDuration(3661)).toBe('01:01:01')
  })

  it('超过 24 小时不折叠为天', () => {
    expect(formatDuration(95000)).toBe('26:23:20')
    expect(formatDuration(10_000_000)).toBe('2777:46:40')
  })

  it('小数秒向下取整', () => {
    expect(formatDuration(3599.9)).toBe('00:59:59')
  })

  it('无效输入返回占位符', () => {
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(NaN)).toBe('—')
  })
})

describe('formatSpeed', () => {
  it('m/s 转 km/h 显示 1 位小数', () => {
    expect(formatSpeed(6.8)).toBe('24.5 km/h')
    expect(formatSpeed(0)).toBe('0.0 km/h')
    expect(formatSpeed(100)).toBe('360.0 km/h')
  })

  it('无效输入返回占位符', () => {
    expect(formatSpeed(undefined)).toBe('—')
    expect(formatSpeed(null)).toBe('—')
    expect(formatSpeed(NaN)).toBe('—')
  })
})

describe('formatElevation', () => {
  it('带符号整数米', () => {
    expect(formatElevation(642)).toBe('+642 m')
    expect(formatElevation(0)).toBe('+0 m')
    expect(formatElevation(-50)).toBe('-50 m')
    expect(formatElevation(642.6)).toBe('+643 m')
  })

  it('无效输入返回占位符', () => {
    expect(formatElevation(undefined)).toBe('—')
    expect(formatElevation(null)).toBe('—')
    expect(formatElevation(NaN)).toBe('—')
  })
})

describe('formatDate', () => {
  it('按本地时区格式化 YYYY-MM-DD（测试固定 UTC）', () => {
    expect(formatDate('2026-08-16T10:00:00.000Z')).toBe('2026-08-16')
    expect(formatDate('2026-01-05T23:30:00.000Z')).toBe('2026-01-05')
  })

  it('无效输入返回占位符', () => {
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not-a-date')).toBe('—')
  })
})
