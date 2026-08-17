/**
 * 训练状态计算测试（规格 §39 P2）。
 *
 * 验证：每日 TSS 聚合（无 NP 跳过、同日累加）、CTL/ATL 指数加权递推、
 * TSB 前一日口径、天数截断、空数据边界。
 */
import { describe, expect, it } from 'vitest'
import {
  ATL_TIME_CONSTANT_DAYS,
  buildDailyTss,
  buildTrainingStatus,
  CTL_TIME_CONSTANT_DAYS,
  type TssActivity,
} from '@/features/analysis/trainingStatus'

/** 测试 FTP（W） */
const FTP = 200

/**
 * 生成活动输入。
 *
 * @param startTime 开始时间（ISO 8601）
 * @param duration 时长（秒）
 * @param normalizedPower 标准化功率（W）
 */
function makeActivity(startTime: string, duration: number, normalizedPower?: number): TssActivity {
  return { startTime, duration, normalizedPower }
}

describe('buildDailyTss', () => {
  it('无 NP 的活动不参与聚合', () => {
    const daily = buildDailyTss([makeActivity('2026-08-10T08:00:00', 3600)], FTP)
    expect(daily.size).toBe(0)
  })

  it('IF=1 骑行 1 小时 TSS = 100（基准口径）', () => {
    const daily = buildDailyTss([makeActivity('2026-08-10T08:00:00', 3600, FTP)], FTP)
    expect(daily.get('2026-08-10')).toBeCloseTo(100, 6)
  })

  it('同一自然日多次活动累加', () => {
    const daily = buildDailyTss(
      [
        makeActivity('2026-08-10T08:00:00', 3600, FTP),
        makeActivity('2026-08-10T18:00:00', 1800, FTP),
      ],
      FTP,
    )
    // 100 + 50
    expect(daily.get('2026-08-10')).toBeCloseTo(150, 6)
  })
})

describe('buildTrainingStatus', () => {
  it('空输入返回空数组', () => {
    expect(buildTrainingStatus(new Map())).toEqual([])
  })

  it('恒定每日 TSS 时 CTL/ATL 递增收敛于该值', () => {
    const daily = new Map<string, number>()
    // 300 天恒定 100 TSS（(41/42)^300 < 0.001，收敛到误差 0.5 以内）
    for (let index = 0; index < 300; index++) {
      const date = new Date(2026, 0, 1 + index)
      daily.set(localKey(date), 100)
    }
    const points = buildTrainingStatus(daily, 90, new Date(2026, 9, 27))

    expect(points).toHaveLength(90)
    const last = points[points.length - 1]
    expect(last.ctl).toBeCloseTo(100, 0)
    expect(last.atl).toBeCloseTo(100, 0)
    expect(last.tsb).toBeCloseTo(0, 0)
  })

  it('单日 TSS 冲击：首日 CTL = TSS/42、ATL = TSS/7，TSB 前一日口径为 0', () => {
    const daily = new Map([[localKey(new Date(2026, 7, 10)), 84]])
    const points = buildTrainingStatus(daily, 90, new Date(2026, 7, 10))

    expect(points).toHaveLength(1)
    expect(points[0].ctl).toBeCloseTo(84 / CTL_TIME_CONSTANT_DAYS, 6)
    expect(points[0].atl).toBeCloseTo(84 / ATL_TIME_CONSTANT_DAYS, 6)
    expect(points[0].tsb).toBe(0)
  })

  it('无 TSS 的日期负荷按指数衰减', () => {
    const first = new Date(2026, 7, 10)
    const daily = new Map([[localKey(first), 84]])
    const points = buildTrainingStatus(daily, 90, new Date(2026, 7, 11))

    expect(points).toHaveLength(2)
    // 第二天无 TSS：CTL = 前一日 × (1 - 1/42)
    expect(points[1].ctl).toBeCloseTo((84 / 42) * (1 - 1 / 42), 6)
    // 第二天 TSB = 第一日 CTL − 第一日 ATL（负值，疲劳高于体能）
    expect(points[1].tsb).toBeCloseTo(84 / 42 - 84 / 7, 6)
  })

  it('返回天数截断为最近 days 天', () => {
    const daily = new Map<string, number>()
    for (let index = 0; index < 200; index++) {
      daily.set(localKey(new Date(2026, 0, 1 + index)), 50)
    }
    const points = buildTrainingStatus(daily, 30, new Date(2026, 6, 19))

    expect(points).toHaveLength(30)
    expect(points[points.length - 1].date).toBe(localKey(new Date(2026, 6, 19)))
  })
})

/**
 * 本地时区日期键（与被测实现同口径）。
 *
 * @param date 日期
 */
function localKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
