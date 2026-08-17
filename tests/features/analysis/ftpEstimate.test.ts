/**
 * FTP / VO2Max 估算纯函数测试（规格 §39）。
 *
 * 验证估算公式（FTP = 20 分钟最佳 × 0.95；VO2Max = 10.8 × 5 分钟最佳 ÷ 体重 + 7）
 * 与不伪造原则：缺失/非法输入返回 undefined。
 */
import { describe, expect, it } from 'vitest'
import {
  FTP_ESTIMATE_FACTOR,
  FTP_POWER_DURATION_SECONDS,
  VO2MAX_POWER_DURATION_SECONDS,
  estimateFtp,
  estimateVo2max,
} from '@/features/analysis/ftpEstimate'

describe('estimateFtp', () => {
  it('20 分钟最佳功率 × 0.95 取整', () => {
    expect(FTP_ESTIMATE_FACTOR).toBe(0.95)
    expect(FTP_POWER_DURATION_SECONDS).toBe(1200)
    expect(estimateFtp(200)).toBe(190)
    // 非整数结果四舍五入到整数瓦特
    expect(estimateFtp(253)).toBe(240)
  })

  it('缺失/非法输入返回 undefined（不伪造）', () => {
    expect(estimateFtp(undefined)).toBeUndefined()
    expect(estimateFtp(0)).toBeUndefined()
    expect(estimateFtp(-100)).toBeUndefined()
    expect(estimateFtp(Number.NaN)).toBeUndefined()
    expect(estimateFtp(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})

describe('estimateVo2max', () => {
  it('10.8 × 5 分钟最佳功率 ÷ 体重 + 7（1 位小数）', () => {
    expect(VO2MAX_POWER_DURATION_SECONDS).toBe(300)
    // 10.8 × 200 / 70 + 7 = 37.857… → 37.9
    expect(estimateVo2max(200, 70)).toBe(37.9)
  })

  it('体重或功率缺失/非法返回 undefined（不伪造）', () => {
    expect(estimateVo2max(undefined, 70)).toBeUndefined()
    expect(estimateVo2max(200, undefined)).toBeUndefined()
    expect(estimateVo2max(0, 70)).toBeUndefined()
    expect(estimateVo2max(200, 0)).toBeUndefined()
    expect(estimateVo2max(200, -60)).toBeUndefined()
    expect(estimateVo2max(Number.NaN, 70)).toBeUndefined()
  })
})
