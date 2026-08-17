/**
 * 功率曲线计算测试（规格 §39 P2）。
 *
 * 验证：恒定/阶梯/峰值功率的已知最佳值、缺失功率过滤、断档能量钳制、
 * 活动跨度不足跳过、乱序输入防御、空数据边界。
 */
import { describe, expect, it } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import { buildPowerCurve, POWER_CURVE_DURATIONS } from '@/features/analysis/powerCurve'

/**
 * 生成等间隔记录。
 *
 * @param powers 功率序列（undefined = 该点缺失功率）
 * @param start 起始时间（Unix 秒）
 * @param step 采样间隔（秒）
 */
function makeRecords(powers: readonly (number | undefined)[], start = 1000, step = 1): ActivityRecord[] {
  return powers.map((power, index) => ({
    timestamp: start + index * step,
    power,
  }))
}

describe('buildPowerCurve', () => {
  it('空记录返回空曲线', () => {
    expect(buildPowerCurve([])).toEqual([])
  })

  it('全部缺失功率返回空曲线', () => {
    const records = makeRecords([undefined, undefined, undefined])
    expect(buildPowerCurve(records)).toEqual([])
  })

  it('恒定功率：所有时长最佳功率恒等于该功率', () => {
    const records = makeRecords(new Array<number>(100).fill(150))
    const curve = buildPowerCurve(records, [1, 5, 30, 99])

    expect(curve).toHaveLength(4)
    for (const point of curve) {
      expect(point.power).toBeCloseTo(150, 6)
    }
  })

  it('活动跨度不足的时长不产生采样点', () => {
    // 100 点 1s 采样：最大跨度 99s，100s 时长无点
    const records = makeRecords(new Array<number>(100).fill(150))
    const curve = buildPowerCurve(records, [50, 100])

    expect(curve).toEqual([{ duration: 50, power: 150 }])
  })

  it('阶梯功率：短时长取高功率段，长时长加权平均', () => {
    // 前 50s 100W + 后 50s 200W
    const records = makeRecords([
      ...new Array<number>(50).fill(100),
      ...new Array<number>(50).fill(200),
    ])
    const curve = buildPowerCurve(records, [50, 99])

    expect(curve[0]).toEqual({ duration: 50, power: 200 })
    // 全程窗口 [0, 99]：(49×100 + 50×200) / 99
    expect(curve[1].duration).toBe(99)
    expect(curve[1].power).toBeCloseTo((49 * 100 + 50 * 200) / 99, 6)
  })

  it('单点峰值：1s 最佳功率等于最大单点功率', () => {
    const powers = new Array<number>(100).fill(100)
    powers[50] = 500
    const curve = buildPowerCurve(makeRecords(powers), [1])

    expect(curve).toEqual([{ duration: 1, power: 500 }])
  })

  it('缺失功率的记录被过滤，不影响其余区间', () => {
    const powers: (number | undefined)[] = new Array<number>(10).fill(100)
    powers[5] = undefined
    const curve = buildPowerCurve(makeRecords(powers), [9])

    expect(curve).toEqual([{ duration: 9, power: 100 }])
  })

  it('断档超过 5s 的区间能量按 5s 钳制（窗口平均被拉低而非按全程计）', () => {
    // t=0..4（100W），t=15（间隔 11s，100W）：最佳 11s 窗口为全程 [0, 15]，
    // 能量 = 4×100（连续段）+ 100×5（断档钳制），不钳制则能量 = 400 + 1100
    const records = makeRecords([100, 100, 100, 100, 100]).concat(makeRecords([100], 1015))
    const curve = buildPowerCurve(records, [11])

    expect(curve).toHaveLength(1)
    expect(curve[0].power).toBeCloseTo((400 + 500) / 15, 6)
  })

  it('乱序输入与有序输入结果一致', () => {
    const ordered = makeRecords([100, 200, 150, 180, 120, 160, 140, 170, 110, 190])
    const shuffled = [...ordered].reverse()
    expect(buildPowerCurve(shuffled, [1, 3, 5])).toEqual(buildPowerCurve(ordered, [1, 3, 5]))
  })

  it('默认时长集：结果按时长升序且不超过活动跨度', () => {
    const records = makeRecords(new Array<number>(400).fill(180))
    const curve = buildPowerCurve(records)

    expect(curve.length).toBeGreaterThan(0)
    expect(curve.every((point) => point.power === 180)).toBe(true)
    expect(curve.map((point) => point.duration)).toEqual(
      POWER_CURVE_DURATIONS.filter((duration) => duration <= 399),
    )
  })
})
