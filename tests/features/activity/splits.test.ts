/**
 * 分段详情（splits）纯函数测试。
 *
 * - 整段切分：段末点取首个累计里程 ≥ 段起 + 段长的记录；
 * - 末段不足一段按实际距离收尾；
 * - 平均速度 = 段距离/用时；平均心率 = 段内心率点算术平均；
 * - distance 缺失的记录不参与边界判断；心率缺失显示 undefined。
 */
import { describe, expect, it } from 'vitest'
import { buildSplits } from '@/features/activity/splits'
import type { ActivityRecord } from '@/types/activity'

/**
 * 构造等距记录：每点前进 stepMeters 米、间隔 10 秒。
 *
 * @param count 点数
 * @param stepMeters 每点步进距离（米）
 * @param heartRates 各点心率（可选，缺省全部缺失）
 */
function makeRecords(count: number, stepMeters: number, heartRates?: Array<number | undefined>): ActivityRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i * 10,
    distance: i * stepMeters,
    heartRate: heartRates?.[i],
  }))
}

describe('buildSplits', () => {
  it('按段长切分：5km 段长切 12km 得 2 整段 + 1 末段（实际距离）', () => {
    // 每点 100m × 121 点 = 12km，段长 5000m
    const splits = buildSplits(makeRecords(121, 100), 5000)

    expect(splits).toHaveLength(3)
    expect(splits[0]).toMatchObject({ index: 1, startDistance: 0, endDistance: 5000, duration: 500, avgSpeed: 10 })
    expect(splits[1]).toMatchObject({ index: 2, startDistance: 5000, endDistance: 10000, duration: 500, avgSpeed: 10 })
    // 末段不足 5km：实际 2km
    expect(splits[2]).toMatchObject({ index: 3, startDistance: 10000, endDistance: 12000, duration: 200, avgSpeed: 10 })
  })

  it('段内心率取算术平均，缺失点跳过', () => {
    // 每点 1000m × 3 点 = 2km，段长 1km：两段心率分别 [100,120] 与 [120,140]
    const splits = buildSplits(makeRecords(3, 1000, [100, 120, 140]), 1000)

    expect(splits).toHaveLength(2)
    expect(splits[0].avgHeartRate).toBe(110)
    expect(splits[1].avgHeartRate).toBe(130)
  })

  it('段内心率全部缺失时 avgHeartRate 为 undefined', () => {
    const splits = buildSplits(makeRecords(11, 100), 500)

    expect(splits).toHaveLength(2)
    expect(splits[0].avgHeartRate).toBeUndefined()
  })

  it('distance 缺失的记录不参与边界判断', () => {
    const records: ActivityRecord[] = [
      { timestamp: 0, distance: 0 },
      { timestamp: 10 },
      { timestamp: 20, distance: 1000 },
    ]
    const splits = buildSplits(records, 1000)

    expect(splits).toHaveLength(1)
    expect(splits[0]).toMatchObject({ startDistance: 0, endDistance: 1000, duration: 20 })
  })

  it('总距离不足一段时输出单段（按实际距离）', () => {
    const splits = buildSplits(makeRecords(5, 100), 5000)

    expect(splits).toHaveLength(1)
    expect(splits[0].endDistance).toBe(400)
  })

  it('无距离数据时返回空数组', () => {
    expect(buildSplits([{ timestamp: 0 }, { timestamp: 10 }], 5000)).toEqual([])
    expect(buildSplits([], 5000)).toEqual([])
  })
})
