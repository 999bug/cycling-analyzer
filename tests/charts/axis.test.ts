/**
 * 图表 X 轴格式化测试（规格 §17）：时间轴与距离轴。
 */
import { describe, expect, it } from 'vitest'
import { formatAxisDistance, formatAxisTime } from '@/charts/axis'

describe('formatAxisTime', () => {
  it('不足 1 小时显示分秒', () => {
    expect(formatAxisTime(0)).toBe('00:00')
    expect(formatAxisTime(754)).toBe('12:34')
    expect(formatAxisTime(3599)).toBe('59:59')
  })

  it('超过 1 小时显示时分秒', () => {
    expect(formatAxisTime(3600)).toBe('1:00:00')
    expect(formatAxisTime(3754)).toBe('1:02:34')
  })

  it('负数按 0 处理', () => {
    expect(formatAxisTime(-5)).toBe('00:00')
  })
})

describe('formatAxisDistance', () => {
  it('不足 1km 显示米', () => {
    expect(formatAxisDistance(0)).toBe('0 m')
    expect(formatAxisDistance(850)).toBe('850 m')
  })

  it('达到 1km 显示千米保留 1 位小数', () => {
    expect(formatAxisDistance(1000)).toBe('1.0 km')
    expect(formatAxisDistance(12500)).toBe('12.5 km')
  })
})
