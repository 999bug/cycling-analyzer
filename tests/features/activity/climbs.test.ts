/**
 * 爬坡分析测试。
 *
 * buildClimbs：从逐点记录识别爬坡段（连续爬升累计 ≥ 30m 且平均坡度 ≥ 1.5%），
 * 输出段距离/爬升/平均坡度/最大坡度；下坡或缺失海拔断开段。
 */
import { describe, expect, it } from 'vitest'
import { buildClimbs, uciCategory } from '@/features/activity/climbs'
import type { ActivityRecord } from '@/types/activity'

/**
 * 构造逐点记录。
 *
 * @param items [timestamp, altitude, distance] 三元组
 */
function makeRecords(items: Array<[number, number, number]>): ActivityRecord[] {
  return items.map(([timestamp, altitude, distance]) => ({ timestamp, altitude, distance }))
}

describe('buildClimbs 爬坡分析', () => {
  it('平路无爬坡返回空数组', () => {
    const records = makeRecords([
      [0, 10, 0],
      [10, 10, 100],
      [20, 10, 200],
    ])
    expect(buildClimbs(records)).toEqual([])
  })

  it('连续爬升识别为一个爬坡（爬升/坡度/距离正确）', () => {
    // 1000m 距离爬升 40m → 平均坡度 4%
    const records = makeRecords([
      [0, 100, 0],
      [100, 110, 250],
      [200, 120, 500],
      [300, 130, 750],
      [400, 140, 1000],
    ])
    const climbs = buildClimbs(records)

    expect(climbs).toHaveLength(1)
    expect(climbs[0].distanceMeters).toBeCloseTo(1000, 0)
    expect(climbs[0].elevationGain).toBeCloseTo(40, 0)
    expect(climbs[0].avgGradePercent).toBeCloseTo(4, 0)
  })

  it('爬升不足 30 米不算爬坡', () => {
    // 500m 爬升 10m → 坡度 2% 但爬升不足
    const records = makeRecords([
      [0, 100, 0],
      [100, 102.5, 250],
      [200, 105, 500],
    ])
    expect(buildClimbs(records)).toEqual([])
  })

  it('下坡断开段：两个独立爬坡', () => {
    // 爬 40m → 下 30m → 再爬 40m
    const records = makeRecords([
      [0, 100, 0],
      [100, 120, 500],
      [200, 140, 1000],
      [300, 120, 1300],
      [400, 110, 1500],
      [500, 130, 2000],
      [600, 150, 2500],
    ])
    const climbs = buildClimbs(records)

    expect(climbs).toHaveLength(2)
    expect(climbs[0].elevationGain).toBeCloseTo(40, 0)
    expect(climbs[1].elevationGain).toBeCloseTo(40, 0)
  })

  it('缺失海拔的段内点跳过（不产生假爬升）', () => {
    const records = makeRecords([
      [0, 100, 0],
      [100, 130, 500], // 先涨 30
      [200, 130, 600], // 海拔缺失前的平台
    ])
    records[1] = { timestamp: 100, distance: 500 } // 海拔缺失
    // 实际只有 0→? 无法判断：缺失点断开
    const climbs = buildClimbs(records)
    expect(climbs).toEqual([])
  })

  it('最大坡度为段内 80m 窗口平滑坡度最大值（单点噪声被平滑）', () => {
    // 相邻点坡度：5%、5%、1.67%、3.33%、7.5%（末段 15m/200m）
    // 平滑后窗口坡度最大约 5%（7.5% 的单点坡度被窗口平均），且不出现假大坡度
    const records = makeRecords([
      [0, 100, 0],
      [100, 105, 100],
      [200, 110, 200],
      [300, 115, 500],
      [400, 125, 800],
      [500, 140, 1000],
    ])
    const climbs = buildClimbs(records)

    expect(climbs).toHaveLength(1)
    expect(climbs[0].maxGradePercent).toBeCloseTo(5, 0)
  })

  it('密集点数据（真实设备采样）单点坡度噪声不产生虚假大坡度', () => {
    // 真实设备场景：点距 3.5m、海拔量化 1m 步进（每 ~7 点 +1m = 4% 坡，
    // 偶发 -1m 噪声），单点对坡度可达 28%+，但 80m 窗口平滑后应回到真实范围
    const records: ActivityRecord[] = []
    for (let i = 0; i <= 400; i++) {
      const altitude = Math.round(100 + i * 0.14) - (i % 19 === 7 ? 1 : 0)
      records.push({ timestamp: i * 2, altitude, distance: i * 3.5 })
    }
    const climbs = buildClimbs(records)

    expect(climbs.length).toBeGreaterThan(0)
    expect(climbs[0].maxGradePercent).toBeLessThan(15)
    // 累计爬升接近真实值（1.4km × 4% ≈ 56m，含量化正贡献）
    expect(climbs[0].elevationGain).toBeGreaterThan(30)
  })

  it('海拔噪声点不产生虚假大坡度（突跳点对过滤）', () => {
    // 正常 4% 爬升中夹一个海拔突跳点（120 → 160 → 121）
    const records = makeRecords([
      [0, 100, 0],
      [100, 120, 500],
      [200, 160, 510], // 噪声：10m 内跳 40m（400%）
      [300, 121, 520],
      [400, 141, 1000],
      [500, 160, 1500],
    ])
    const climbs = buildClimbs(records)

    expect(climbs).toHaveLength(1)
    // 最大坡度不超过物理上限（噪声被过滤）
    expect(climbs[0].maxGradePercent).toBeLessThanOrEqual(30)
  })

  it('距离过近的点对（停车/低速噪声）不参与坡度计算', () => {
    // 有效爬升 20 + 30 = 50m（噪声点 1m 内 +1m 跳过不累计）
    const records = makeRecords([
      [0, 100, 0],
      [100, 120, 500],
      [200, 121, 501], // 1m 内 +1m = 100% 坡度（噪声）
      [300, 151, 1000],
    ])
    const climbs = buildClimbs(records)

    expect(climbs).toHaveLength(1)
    expect(climbs[0].maxGradePercent).toBeLessThanOrEqual(30)
  })
})

describe('uciCategory UCI 坡级分类（Strava 官方公式：长度 × 坡度）', () => {
  it('Strava 公式分级（score = 米 × %，阈值 8k/16k/32k/64k/80k）', () => {
    // HC：23.6km × 4% = 94,200 > 80,000
    expect(uciCategory(23600, 4)).toBe('HC')
    expect(uciCategory(12000, 8.5)).toBe('HC') // 102,000
    expect(uciCategory(18000, 6.5)).toBe('HC') // 117,000
    // 1 级：score > 64,000
    expect(uciCategory(10000, 6.5)).toBe(1) // 65,000
    // 2 级：score > 32,000
    expect(uciCategory(6000, 5.5)).toBe(2) // 33,000
    // 3 级：score > 16,000
    expect(uciCategory(4000, 4.5)).toBe(3) // 18,000
    // 4 级：score > 8,000
    expect(uciCategory(3000, 3.5)).toBe(4) // 10,500
  })

  it('长坡缓坡按分数归级（不再要求单段高坡度）', () => {
    // 18km × 3.4% = 61,200 → 2 级（长缓坡也是大坡）
    expect(uciCategory(18000, 3.4)).toBe(2)
  })

  it('坡度或距离不足不分类（score 未过 8,000）', () => {
    expect(uciCategory(500, 5)).toBeNull() // 2,500
    expect(uciCategory(2000, 3.5)).toBeNull() // 7,000
    expect(uciCategory(2000, 2)).toBeNull() // 4,000
    expect(uciCategory(500, 2)).toBeNull() // 1,000
  })
})
