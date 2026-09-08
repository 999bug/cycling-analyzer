/**
 * 自定义筛选纯函数测试（parse/describe/defaultPresetName/conditionsToBounds）。
 * 重点覆盖单位换算（km→米、分钟→秒、km/h→m/s）、介于区间、日期边界与非法输入。
 */
import { describe, expect, it } from 'vitest'
import {
  conditionsToBounds,
  defaultPresetName,
  describeCondition,
  parseCustomFilterCondition,
} from '@/features/activity/customFilter'

describe('parseCustomFilterCondition', () => {
  it('数值条件解析为规范化字符串', () => {
    const result = parseCustomFilterCondition('distance', 'gt', ' 25.5 ', '')
    expect(result).toEqual({ ok: true, condition: { field: 'distance', op: 'gt', value: '25.5' } })
  })

  it('空输入返回 empty 错误', () => {
    expect(parseCustomFilterCondition('distance', 'gt', '  ', '')).toEqual({ ok: false, error: 'empty' })
  })

  it('非数字/负数返回 invalid-number 错误', () => {
    expect(parseCustomFilterCondition('avgPower', 'gt', 'abc', '')).toEqual({
      ok: false,
      error: 'invalid-number',
    })
    expect(parseCustomFilterCondition('avgPower', 'gt', '-1', '')).toEqual({
      ok: false,
      error: 'invalid-number',
    })
  })

  it('介于缺少上限返回 missing-value2，下限大于上限返回 invalid-order', () => {
    expect(parseCustomFilterCondition('distance', 'between', '10', '')).toEqual({
      ok: false,
      error: 'missing-value2',
    })
    expect(parseCustomFilterCondition('distance', 'between', '30', '20')).toEqual({
      ok: false,
      error: 'invalid-order',
    })
  })

  it('介于闭区间解析成功（数值）', () => {
    const result = parseCustomFilterCondition('avgSpeed', 'between', '25', '40')
    expect(result).toEqual({
      ok: true,
      condition: { field: 'avgSpeed', op: 'between', value: '25', value2: '40' },
    })
  })

  it('日期条件直存字符串，介于校验先后顺序', () => {
    expect(parseCustomFilterCondition('startTime', 'gt', '2026-08-01', '')).toEqual({
      ok: true,
      condition: { field: 'startTime', op: 'gt', value: '2026-08-01' },
    })
    expect(parseCustomFilterCondition('startTime', 'between', '2026-08-10', '2026-08-01')).toEqual({
      ok: false,
      error: 'invalid-order',
    })
    expect(parseCustomFilterCondition('startTime', 'between', '2026-08-01', '2026-08-10')).toEqual({
      ok: true,
      condition: { field: 'startTime', op: 'between', value: '2026-08-01', value2: '2026-08-10' },
    })
  })
})

describe('describeCondition / defaultPresetName', () => {
  it('条件文案带单位', () => {
    expect(describeCondition({ field: 'distance', op: 'gt', value: '20' })).toBe('距离 大于 20 km')
    expect(describeCondition({ field: 'avgSpeed', op: 'between', value: '25', value2: '40' })).toBe(
      '平均速度 25 ~ 40 km/h',
    )
    expect(describeCondition({ field: 'startTime', op: 'eq', value: '2026-08-01' })).toBe('日期 等于 2026-08-01')
  })

  it('默认预设名按条件文案用「且」连接，超长截断', () => {
    expect(defaultPresetName([{ field: 'distance', op: 'gt', value: '20' }])).toBe('距离 大于 20 km')
    const long = defaultPresetName([
      { field: 'distance', op: 'gt', value: '20' },
      { field: 'avgSpeed', op: 'between', value: '25', value2: '40' },
      { field: 'avgPower', op: 'lt', value: '300' },
      { field: 'avgHeartRate', op: 'gt', value: '140' },
    ])
    expect(long.length).toBeLessThanOrEqual(25)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('conditionsToBounds', () => {
  it('数值条件换算到领域单位（km→米、分钟→秒、km/h→m/s）', () => {
    const bounds = conditionsToBounds([
      { field: 'distance', op: 'gt', value: '20' },
      { field: 'duration', op: 'lt', value: '60' },
      { field: 'avgSpeed', op: 'between', value: '18', value2: '36' },
    ])
    expect(bounds.minDistance).toBe(20000)
    expect(bounds.maxDuration).toBe(3600)
    // km/h → m/s：18/3.6=5、36/3.6=10
    expect(bounds.minAvgSpeed).toBeCloseTo(5)
    expect(bounds.maxAvgSpeed).toBeCloseTo(10)
  })

  it('等于生成含边界 min=max', () => {
    const bounds = conditionsToBounds([{ field: 'avgPower', op: 'eq', value: '250' }])
    expect(bounds.minAvgPower).toBe(250)
    expect(bounds.maxAvgPower).toBe(250)
  })

  it('同字段多条件 AND 收敛：下界取大、上界取小', () => {
    const bounds = conditionsToBounds([
      { field: 'distance', op: 'gt', value: '10' },
      { field: 'distance', op: 'gt', value: '30' },
      { field: 'distance', op: 'lt', value: '50' },
      { field: 'distance', op: 'lt', value: '40' },
    ])
    expect(bounds.minDistance).toBe(30000)
    expect(bounds.maxDistance).toBe(40000)
  })

  it('日期 gt/lt 转换为前后日边界（UTC 日前缀比较口径）', () => {
    const bounds = conditionsToBounds([
      { field: 'startTime', op: 'gt', value: '2026-08-30' },
      { field: 'startTime', op: 'lt', value: '2026-08-02' },
    ])
    // 大于 08-30 → 日期 ≥ 08-31；小于 08-02 → 日期 ≤ 08-01
    expect(bounds.startTimeFrom).toBe('2026-08-31')
    expect(bounds.startTimeTo).toBe('2026-08-01')
  })

  it('日期介于为闭区间，多条件收敛取更紧者', () => {
    const bounds = conditionsToBounds([
      { field: 'startTime', op: 'between', value: '2026-08-01', value2: '2026-08-31' },
      { field: 'startTime', op: 'between', value: '2026-08-10', value2: '2026-08-20' },
    ])
    expect(bounds.startTimeFrom).toBe('2026-08-10')
    expect(bounds.startTimeTo).toBe('2026-08-20')
  })

  it('空条件列表返回空对象', () => {
    expect(conditionsToBounds([])).toEqual({})
  })
})
