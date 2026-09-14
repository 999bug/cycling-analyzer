/**
 * AI 提示词与上行数据测试（aiPrompts）。
 * 核心契约：payload 只含聚合指标、绝不含 GPS/逐点序列；文案解析能兜住
 * 模型不守格式的常见情形（代码围栏、「标题：」前缀）。
 */
import { describe, expect, it } from 'vitest'
import type { Activity } from '@/types/activity'
import {
  buildInsightEnhanceRequest,
  buildScoreExplainRequest,
  buildSegmentsCommentRequest,
} from '@/features/ai/aiPrompts'
import {
  buildAiMetricsPayload,
  buildCaptionRequest,
  buildInsightRequest,
  formatMetricsForPrompt,
  parseCaptionResponse,
} from '@/features/ai/aiPrompts'

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    fileId: 'file-1',
    fileName: 'sample.fit',
    fingerprint: 'fp-1',
    activityType: 'cycling',
    startTime: '2026-09-13T06:32:00',
    endTime: '2026-09-13T08:02:00',
    duration: 5421,
    elapsedTime: 5700,
    distance: 42_700,
    elevationGain: 683,
    avgSpeed: 7.89,
    normalizedPower: 218,
    avgHeartRate: 152,
    name: '晨骑 · 环滴水湖',
    ...overrides,
  }
}

describe('buildAiMetricsPayload', () => {
  it('只含聚合指标，绝无坐标/轨迹/逐点字段', () => {
    const payload = buildAiMetricsPayload(makeActivity())
    const keys = Object.keys(payload).join()
    expect(keys).not.toMatch(/latitude|longitude|经纬|轨迹|坐标|points/i)
    expect(payload['距离']).toBe('42.70 km')
    expect(payload['标准化功率']).toBe('218 W')
    expect(payload['骑行类型（本地结论）']).toBeDefined()
  })

  it('缺失字段不出现（undefined ≠ 0，不伪造）', () => {
    const payload = buildAiMetricsPayload(makeActivity({ normalizedPower: undefined, avgHeartRate: undefined }))
    expect(payload['标准化功率']).toBeUndefined()
    expect(payload['平均心率']).toBeUndefined()
  })

  it('无功率摘要时回退平均功率口径', () => {
    const payload = buildAiMetricsPayload(makeActivity({ normalizedPower: undefined, avgPower: 180 }))
    expect(payload['平均功率']).toBe('180 W')
  })

  it('英里单位下距离与均速按 mi 显示', () => {
    const payload = buildAiMetricsPayload(makeActivity(), { distanceUnit: 'mi' })
    expect(payload['距离']).toMatch(/mi$/)
    expect(payload['均速']).toMatch(/mph$/)
  })
})

describe('formatMetricsForPrompt', () => {
  it('逐行键值对', () => {
    expect(formatMetricsForPrompt({ 距离: '42.70 km', 爬升: '683 米' })).toBe('距离：42.70 km\n爬升：683 米')
  })
})

describe('buildCaptionRequest / buildInsightRequest', () => {
  it('文案与解读请求都带禁编造约束，数据段来自 payload', () => {
    for (const request of [
      buildCaptionRequest(makeActivity(), 'moments'),
      buildCaptionRequest(makeActivity(), 'xhs'),
      buildInsightRequest(makeActivity(), { ftp: 235 }),
    ]) {
      expect(request.system).toContain('禁止编造')
      expect(request.system).toContain('禁止使用任何 emoji')
      expect(request.user).toContain('距离：42.70 km')
    }
  })

  it('小红书要求首行标题 ≤20 字，朋友圈只输出本体', () => {
    const xhs = buildCaptionRequest(makeActivity(), 'xhs')
    expect(xhs.system).toContain('不超过 20 个字')
    const moments = buildCaptionRequest(makeActivity(), 'moments')
    expect(moments.system).toContain('只输出文案本体')
  })
})

describe('parseCaptionResponse', () => {
  it('xhs：首行标题、其余正文', () => {
    const result = parseCaptionResponse('xhs', '42.7km晨骑打卡\n\n今天骑了 42.7 公里。\n#骑行')
    expect(result.title).toBe('42.7km晨骑打卡')
    expect(result.body).toContain('42.7 公里')
  })

  it('兜住代码围栏与「标题：」前缀', () => {
    const result = parseCaptionResponse('xhs', '```text\n标题：42.7km 晨骑\n\n正文第一行\n```')
    expect(result.title).toBe('42.7km 晨骑')
    expect(result.body).toBe('正文第一行')
  })

  it('moments：整段即正文，剥「文案：」前缀', () => {
    const result = parseCaptionResponse('moments', '文案：骑了 42.7 公里。')
    expect(result.body).toBe('骑了 42.7 公里。')
    expect(result.title).toBeUndefined()
  })

  it('xhs 模型没给标题行时正文兜底、标题缺省', () => {
    const result = parseCaptionResponse('xhs', '只有一段话')
    expect(result.title).toBeUndefined()
    expect(result.body).toContain('只有一段话')
  })
})

describe('内容面增强提示词（v4）', () => {
  const conclusions = [
    { kind: '强度', title: '心率处于 Z3 区间', text: '平均心率 152 bpm，全程有氧为主。' },
    { kind: '功率', title: '标准化功率 218 W', text: '达到 FTP（235 W）的 93%。' },
  ]

  it('洞察增强：带本地结论与禁编造约束，不含任何 GPS 字段', () => {
    const request = buildInsightEnhanceRequest(makeActivity(), conclusions)
    expect(request.system).toContain('禁止编造')
    expect(request.user).toContain('[强度] 心率处于 Z3 区间')
    expect(request.user).not.toMatch(/latitude|longitude|经纬|轨迹点/i)
  })

  it('评分解读：带综合分与分项', () => {
    const request = buildScoreExplainRequest(78, [
      { label: '强度', score: 92 },
      { label: '耐力', score: 74 },
      { label: '技术', score: undefined },
    ], makeActivity())
    expect(request.user).toContain('综合分：78/100')
    expect(request.user).toContain('技术：无数据')
  })

  it('赛段点评：带各赛段计时与差值（不含坐标）', () => {
    const request = buildSegmentsCommentRequest([
      { name: '九溪爬坡', durationSeconds: 243, prSeconds: 245, rank: 1, distanceKm: 1.8, avgSpeed: 7.4 },
    ], '晨骑 · 环滴水湖')
    expect(request.user).toContain('九溪爬坡')
    expect(request.user).toContain('新纪录（较此前最好快')
    expect(request.user).not.toMatch(/latitude|longitude/i)
  })
})
