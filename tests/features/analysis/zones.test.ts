/**
 * 心率/功率训练区间分布单测（规格 §26）。
 * 覆盖：区间归属与时长累计（手算序列）、边界值（恰好 60%/90%、55%/105%）、
 * 缺失指标跳过、时间未推进防御、配置缺失/无效返回 null。
 */
import { describe, expect, it } from 'vitest'
import { calculateHeartRateZones, calculatePowerZones } from '@/features/analysis/zones'
import type { ActivityRecord } from '@/types/activity'

/**
 * 构造逐点记录（未提供的可选字段为 undefined，模拟缺失）。
 *
 * @param timestamp 时间（Unix 秒）
 * @param heartRate 心率（bpm，可缺失）
 * @param power 功率（W，可缺失）
 * @returns 逐点记录
 */
function makeRecord(timestamp: number, heartRate?: number, power?: number): ActivityRecord {
  return { timestamp, heartRate, power }
}

describe('calculateHeartRateZones', () => {
  it('区间归属与时长累计：每段时长归当前记录心率所在区间', () => {
    // maxHR=200，间隔 10 秒：
    // t=10 时 120 bpm（60%）→ Z2、t=20 时 150（75%）→ Z3、
    // t=30 时 180（90%）→ Z5、t=40 时 100（50%）→ Z1
    // 各 10 秒：Z1 10s、Z2 10s、Z3 10s、Z4 0s、Z5 10s
    const records = [
      makeRecord(0, 90),
      makeRecord(10, 120),
      makeRecord(20, 150),
      makeRecord(30, 180),
      makeRecord(40, 100),
    ]
    const zones = calculateHeartRateZones(records, 200)
    expect(zones).not.toBeNull()
    expect(zones!.map((entry) => entry.seconds)).toEqual([10, 10, 10, 0, 10])
    expect(zones!.map((entry) => entry.percent)).toEqual([25, 25, 25, 0, 25])
  })

  it('边界值：恰好 60%/70%/80%/90% 归入更高区间', () => {
    // maxHR=200：119 bpm（59.5%）→ Z1（但为首点不计）、120（60%）→ Z2、139（69.5%）→ Z2、
    // 140（70%）→ Z3、159（79.5%）→ Z3、160（80%）→ Z4、179（89.5%）→ Z4、180（90%）→ Z5
    const records = [119, 120, 139, 140, 159, 160, 179, 180].map((hr, i) => makeRecord(i * 10, hr))
    const zones = calculateHeartRateZones(records, 200)!
    expect(zones.map((entry) => entry.seconds)).toEqual([0, 20, 20, 20, 10])
    // 总有效时长 70 秒：Z2/Z3/Z4 各 20s（约 28.57%）、Z5 10s（约 14.29%）
    expect(zones.map((entry) => entry.percent)).toEqual([
      0,
      20 / 70 * 100,
      20 / 70 * 100,
      20 / 70 * 100,
      10 / 70 * 100,
    ])
  })

  it('缺失心率的记录跳过：该段不计入任何区间', () => {
    // t=10 记录心率缺失 → 段（0-10）不计；仅段（10-20）归 t=20 的 180（90% → Z5）
    const records = [makeRecord(0, 100), makeRecord(10), makeRecord(20, 180)]
    const zones = calculateHeartRateZones(records, 200)!
    expect(zones[4]).toEqual({ zone: 5, seconds: 10, percent: 100 })
    expect(zones[0]).toEqual({ zone: 1, seconds: 0, percent: 0 })
  })

  it('时间未推进的记录不计入（重复时间戳防御）', () => {
    const records = [makeRecord(0, 100), makeRecord(0, 180), makeRecord(10, 150)]
    const zones = calculateHeartRateZones(records, 200)!
    // 仅段（0-10）计入，归 t=10 的 150（75% → Z3）
    expect(zones[2]).toEqual({ zone: 3, seconds: 10, percent: 100 })
  })

  it('首点不计：单条记录全区间为 0', () => {
    const zones = calculateHeartRateZones([makeRecord(0, 150)], 200)!
    expect(zones.map((entry) => entry.seconds)).toEqual([0, 0, 0, 0, 0])
    expect(zones.map((entry) => entry.percent)).toEqual([0, 0, 0, 0, 0])
  })

  it('全部记录缺失心率时各区间为 0（不返回 null）', () => {
    const zones = calculateHeartRateZones([makeRecord(0), makeRecord(10)], 200)
    expect(zones).not.toBeNull()
    expect(zones!.map((entry) => entry.seconds)).toEqual([0, 0, 0, 0, 0])
  })

  it('空数组时各区间为 0（不返回 null）', () => {
    const zones = calculateHeartRateZones([], 200)
    expect(zones).not.toBeNull()
    expect(zones!.map((entry) => entry.percent)).toEqual([0, 0, 0, 0, 0])
  })

  it('最大心率未配置/无效时返回 null', () => {
    expect(calculateHeartRateZones([makeRecord(0, 150)], undefined)).toBeNull()
    expect(calculateHeartRateZones([makeRecord(0, 150)], Number.NaN)).toBeNull()
    expect(calculateHeartRateZones([makeRecord(0, 150)], 0)).toBeNull()
    expect(calculateHeartRateZones([makeRecord(0, 150)], -180)).toBeNull()
  })
})

describe('calculatePowerZones', () => {
  it('区间归属与时长累计：每段时长归当前记录功率所在区间', () => {
    // ftp=200，间隔 10 秒：
    // t=10 时 110 W（55%）→ Z2、t=20 时 150（75%）→ Z3、
    // t=30 时 180（90%）→ Z4、t=40 时 210（105%）→ Z5
    // 各 10 秒：Z1 0s、Z2 10s、Z3 10s、Z4 10s、Z5 10s
    const records = [
      makeRecord(0, undefined, 100),
      makeRecord(10, undefined, 110),
      makeRecord(20, undefined, 150),
      makeRecord(30, undefined, 180),
      makeRecord(40, undefined, 210),
    ]
    const zones = calculatePowerZones(records, 200)
    expect(zones).not.toBeNull()
    expect(zones!.map((entry) => entry.seconds)).toEqual([0, 10, 10, 10, 10])
    expect(zones!.map((entry) => entry.percent)).toEqual([0, 25, 25, 25, 25])
  })

  it('边界值：恰好 55%/75%/90%/105% 归入更高区间', () => {
    // ftp=200：109 W（54.5%）→ Z1（但为首点不计）、110（55%）→ Z2、149（74.5%）→ Z2、
    // 150（75%）→ Z3、179（89.5%）→ Z3、180（90%）→ Z4、209（104.5%）→ Z4、210（105%）→ Z5
    const records = [109, 110, 149, 150, 179, 180, 209, 210].map((p, i) => makeRecord(i * 10, undefined, p))
    const zones = calculatePowerZones(records, 200)!
    expect(zones.map((entry) => entry.seconds)).toEqual([0, 20, 20, 20, 10])
  })

  it('缺失功率的记录跳过：该段不计入任何区间', () => {
    const records = [makeRecord(0, undefined, 100), makeRecord(10), makeRecord(20, undefined, 220)]
    const zones = calculatePowerZones(records, 200)!
    // 仅段（10-20）计入，归 t=20 的 220 W（110% → Z5）
    expect(zones[4]).toEqual({ zone: 5, seconds: 10, percent: 100 })
  })

  it('全部记录缺失功率时各区间为 0（不返回 null）', () => {
    const zones = calculatePowerZones([makeRecord(0), makeRecord(10)], 200)
    expect(zones).not.toBeNull()
    expect(zones!.map((entry) => entry.seconds)).toEqual([0, 0, 0, 0, 0])
  })

  it('FTP 未配置/无效时返回 null', () => {
    expect(calculatePowerZones([makeRecord(0, undefined, 150)], undefined)).toBeNull()
    expect(calculatePowerZones([makeRecord(0, undefined, 150)], Number.NaN)).toBeNull()
    expect(calculatePowerZones([makeRecord(0, undefined, 150)], 0)).toBeNull()
    expect(calculatePowerZones([makeRecord(0, undefined, 150)], -200)).toBeNull()
  })
})
