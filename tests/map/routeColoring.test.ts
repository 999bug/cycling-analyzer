/**
 * 轨迹分段着色测试（规格 §16）。
 * 覆盖：相邻点成段、值域映射（固定域/数据域）、缺失值处理、
 * 空数组、全同值、分桶合并。
 */
import { describe, expect, it } from 'vitest'
import type { RoutePoint } from '@/types/activity'
import {
  buildBucketLines,
  buildSegments,
  getColorForValue,
  getMetricValue,
  getValueRange,
} from '@/map/routeColoring'

/**
 * 构造轨迹点（经纬度必填，指标字段可覆盖）。
 *
 * @param overrides 覆盖字段
 */
function makePoint(overrides: Partial<RoutePoint>): RoutePoint {
  return { timestamp: 1, latitude: 39.9, longitude: 116.4, ...overrides }
}

describe('getMetricValue', () => {
  it('按模式读取对应指标字段', () => {
    const point = makePoint({ speed: 5.5, heartRate: 150, power: 200, altitude: 100 })
    expect(getMetricValue(point, 'speed')).toBe(5.5)
    expect(getMetricValue(point, 'heartRate')).toBe(150)
    expect(getMetricValue(point, 'power')).toBe(200)
    expect(getMetricValue(point, 'altitude')).toBe(100)
  })

  it('字段缺失时返回 undefined', () => {
    expect(getMetricValue(makePoint({}), 'power')).toBeUndefined()
  })
})

describe('getValueRange', () => {
  it('速度/心率/功率使用固定域', () => {
    const points = [makePoint({ speed: 1, heartRate: 100, power: 50 })]
    expect(getValueRange(points, 'speed')).toEqual({ min: 0, max: 15 })
    expect(getValueRange(points, 'heartRate')).toEqual({ min: 60, max: 200 })
    expect(getValueRange(points, 'power')).toEqual({ min: 0, max: 400 })
  })

  it('海拔使用数据 min-max，忽略缺失点', () => {
    const points = [
      makePoint({ altitude: 300 }),
      makePoint({}), // 海拔缺失
      makePoint({ altitude: 100 }),
      makePoint({ altitude: 250 }),
    ]
    expect(getValueRange(points, 'altitude')).toEqual({ min: 100, max: 300 })
  })

  it('海拔无有效数据时返回 [0, 0]', () => {
    expect(getValueRange([makePoint({})], 'altitude')).toEqual({ min: 0, max: 0 })
  })

  it('海拔全同值时返回单点值', () => {
    expect(getValueRange([makePoint({ altitude: 50 })], 'altitude')).toEqual({ min: 50, max: 50 })
  })
})

describe('getColorForValue', () => {
  it('值域端点映射为蓝/红端点色', () => {
    expect(getColorForValue(0, 'speed', 0, 15)).toBe('hsl(220, 90%, 50%)')
    expect(getColorForValue(15, 'speed', 0, 15)).toBe('hsl(0, 90%, 50%)')
  })

  it('中值映射为色阶中段（绿）', () => {
    expect(getColorForValue(7.5, 'speed', 0, 15)).toBe('hsl(110, 90%, 50%)')
  })

  it('值域外的值夹到端点色', () => {
    expect(getColorForValue(-5, 'speed', 0, 15)).toBe('hsl(220, 90%, 50%)')
    expect(getColorForValue(30, 'speed', 0, 15)).toBe('hsl(0, 90%, 50%)')
  })

  it('min 等于 max（全同值）时取色阶中段', () => {
    expect(getColorForValue(100, 'altitude', 100, 100)).toBe('hsl(110, 90%, 50%)')
  })

  it('色相随值增大从蓝经青绿黄单调过渡到红', () => {
    const colors = [0, 3.75, 7.5, 11.25, 15].map((value) => getColorForValue(value, 'speed', 0, 15))
    expect(colors).toEqual([
      'hsl(220, 90%, 50%)',
      'hsl(165, 90%, 50%)',
      'hsl(110, 90%, 50%)',
      'hsl(55, 90%, 50%)',
      'hsl(0, 90%, 50%)',
    ])
  })
})

describe('buildSegments', () => {
  it('空数组返回空数组', () => {
    expect(buildSegments([], 'speed')).toEqual([])
  })

  it('不足 2 点返回空数组', () => {
    expect(buildSegments([makePoint({ speed: 5 })], 'speed')).toEqual([])
  })

  it('相邻两点成一段，段值取起点指标值', () => {
    const segments = buildSegments(
      [
        makePoint({ latitude: 10, longitude: 20, speed: 3 }),
        makePoint({ latitude: 10.1, longitude: 20.1, speed: 9, timestamp: 2 }),
      ],
      'speed',
    )
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      lat1: 10,
      lng1: 20,
      lat2: 10.1,
      lng2: 20.1,
      value: 3,
    })
  })

  it('3 点拆成 2 段，各段按段值映射颜色', () => {
    const segments = buildSegments(
      [
        makePoint({ speed: 3 }),
        makePoint({ speed: 9, timestamp: 2 }),
        makePoint({ speed: 15, timestamp: 3 }),
      ],
      'speed',
    )
    expect(segments).toHaveLength(2)
    expect(segments[0].value).toBe(3)
    expect(segments[0].color).toBe('hsl(176, 90%, 50%)')
    expect(segments[1].value).toBe(9)
    expect(segments[1].color).toBe('hsl(88, 90%, 50%)')
  })

  it('起点指标缺失时取终点值', () => {
    const segments = buildSegments(
      [
        makePoint({}),
        makePoint({ speed: 9, timestamp: 2 }),
      ],
      'speed',
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].value).toBe(9)
  })

  it('两端指标均缺失的段被跳过', () => {
    const segments = buildSegments(
      [
        makePoint({ speed: 3 }),
        makePoint({}), // 无速度
        makePoint({}), // 无速度
        makePoint({ speed: 12, timestamp: 4 }),
      ],
      'speed',
    )
    expect(segments).toHaveLength(2)
    expect(segments[0].value).toBe(3)
    expect(segments[1].value).toBe(12)
  })

  it('海拔全同值时所有段取色阶中段色', () => {
    const segments = buildSegments(
      [
        makePoint({ altitude: 100 }),
        makePoint({ altitude: 100, timestamp: 2 }),
        makePoint({ altitude: 100, timestamp: 3 }),
      ],
      'altitude',
    )
    expect(segments).toHaveLength(2)
    expect(segments.every((segment) => segment.color === 'hsl(110, 90%, 50%)')).toBe(true)
  })

  it('高值段映射为红色端', () => {
    const [segment] = buildSegments(
      [
        makePoint({ speed: 15 }),
        makePoint({ speed: 0, timestamp: 2 }),
      ],
      'speed',
    )
    expect(segment.value).toBe(15)
    expect(segment.color).toBe('hsl(0, 90%, 50%)')
  })
})

describe('buildBucketLines', () => {
  it('空数组返回空数组', () => {
    expect(buildBucketLines([], 'speed')).toEqual([])
  })

  it('全同值合并为一条折线（中段色）', () => {
    const lines = buildBucketLines(
      [
        makePoint({ altitude: 100 }),
        makePoint({ altitude: 100, timestamp: 2 }),
        makePoint({ altitude: 100, timestamp: 3 }),
      ],
      'altitude',
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].color).toBe('hsl(110, 90%, 50%)')
    expect(lines[0].positions).toHaveLength(3)
  })

  it('同桶相邻段合并为一条折线', () => {
    // 6 / 6.5 / 7 m/s 均落入 speed 域的桶 3（值域 [3.75, 7.5)）
    const lines = buildBucketLines(
      [
        makePoint({ speed: 6 }),
        makePoint({ speed: 6.5, timestamp: 2 }),
        makePoint({ speed: 7, timestamp: 3 }),
      ],
      'speed',
    )
    // 2 段合并为一条折线，3 个坐标点
    expect(lines).toHaveLength(1)
    expect(lines[0].positions).toHaveLength(3)
  })

  it('不同桶的段按桶拆分为多条折线', () => {
    const lines = buildBucketLines(
      [
        makePoint({ speed: 0 }), // 桶 0（蓝端）
        makePoint({ speed: 15, timestamp: 2 }), // 桶 7（红端）
        makePoint({ speed: 0, timestamp: 3 }), // 桶 0
        makePoint({ speed: 15, timestamp: 4 }), // 桶 7（红端）
        makePoint({ speed: 0, timestamp: 5 }), // 桶 0（蓝端）
      ],
      'speed',
    )
    expect(lines).toHaveLength(4)
    expect(lines[0].color).toBe('hsl(206, 90%, 50%)')
    expect(lines[1].color).toBe('hsl(14, 90%, 50%)')
    expect(lines[2].color).toBe(lines[0].color)
    expect(lines[3].color).toBe(lines[1].color)
  })

  it('缺失值处断开折线，同桶段不跨断点合并', () => {
    const lines = buildBucketLines(
      [
        makePoint({ speed: 6 }),
        makePoint({}), // 无速度
        makePoint({}), // 无速度
        makePoint({ speed: 6.5, timestamp: 4 }),
      ],
      'speed',
    )
    expect(lines).toHaveLength(2)
    expect(lines[0].positions).toHaveLength(2)
    expect(lines[1].positions).toHaveLength(2)
    expect(lines[0].color).toBe(lines[1].color)
  })

  it('桶数参数控制分桶粒度', () => {
    // 2 桶下 3 m/s 与 6 m/s 同桶（桶 0 值域 [0, 7.5)）
    const lines = buildBucketLines(
      [
        makePoint({ speed: 3 }),
        makePoint({ speed: 6, timestamp: 2 }),
      ],
      'speed',
      2,
    )
    expect(lines).toHaveLength(1)
    // 桶 0 中心值 3.75 → 色相 165（青）
    expect(lines[0].color).toBe('hsl(165, 90%, 50%)')
  })
})
