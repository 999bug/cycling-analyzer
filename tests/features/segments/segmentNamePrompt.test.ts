/**
 * 赛段推荐 AI 起名提示词测试。
 *
 * 数据边界断言：上行内容只含聚合特征（距离/次数），不含任何轨迹坐标。
 */
import { describe, expect, it } from 'vitest'
import { buildSegmentNameRequest } from '@/features/ai/aiPrompts'

describe('buildSegmentNameRequest', () => {
  it('只上行聚合特征并约束输出形态', () => {
    const request = buildSegmentNameRequest({ distanceKm: 0.95, hitCount: 12 })
    expect(request.system).toContain('赛段名')
    expect(request.user).toContain('0.95 km')
    expect(request.user).toContain('12')
    // max_tokens 由调用方用设置统一上限覆盖（默认 9999）——思考型模型
    // 会先烧 reasoning，固定小额度会「空内容」失败（2.83.0 线上踩坑）
    expect(request.maxTokens).toBe(9_999)
  })

  it('上行内容不含 GPS 坐标样式数据', () => {
    const request = buildSegmentNameRequest({ distanceKm: 1.2, hitCount: 8 })
    const combined = `${request.system}\n${request.user}`
    // 坐标形如 31.200 / 121.5（3 位以上小数的数字对）不应出现
    expect(/\d+\.\d{3,}/.test(combined)).toBe(false)
  })
})
