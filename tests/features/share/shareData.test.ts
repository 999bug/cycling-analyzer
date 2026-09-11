/**
 * 分享素材数据层测试（shareData 纯函数）。
 * 重点：指标缺失显示 '—'（规格 §25）、分段配速距离/时间口径、
 * 爬坡分级、文案数字可复算（不编造统计）。
 */
import { describe, expect, it } from 'vitest'
import type { Activity, ActivityRecord } from '@/types/activity'
import { buildShareData } from '@/features/share/shareData'

/** 构造活动摘要（字段即领域模型，无隐私数据） */
function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    fileId: 'file-1',
    fileName: 'sample.fit',
    fingerprint: 'fp-1',
    activityType: 'cycling',
    startTime: '2026-09-06T07:30:00+08:00',
    endTime: '2026-09-06T12:00:00+08:00',
    duration: 4 * 3600 + 12 * 60,
    elapsedTime: 4.5 * 3600,
    distance: 108_400,
    elevationGain: 1268,
    avgSpeed: 25.8 / 3.6,
    ...overrides,
  }
}

/** 构造逐点记录：匀速段 + 可选坐标/海拔 */
function makeRecords(
  count: number,
  options: {
    speedMps?: number
    stepMeters?: number
    stepSeconds?: number
    withGeo?: boolean
    altitude?: (index: number) => number
  } = {},
): ActivityRecord[] {
  const speedMps = options.speedMps ?? 8
  const stepMeters = options.stepMeters ?? speedMps * 30
  const stepSeconds = options.stepSeconds ?? 30
  const records: ActivityRecord[] = []
  for (let index = 0; index <= count; index += 1) {
    records.push({
      timestamp: 1_787_000_000 + index * stepSeconds,
      latitude: options.withGeo === true ? 30.0 + index * 0.001 : undefined,
      longitude: options.withGeo === true ? 120.0 + index * 0.001 : undefined,
      altitude: options.altitude?.(index),
      distance: index * stepMeters,
      speed: speedMps,
    })
  }
  return records
}

describe('buildShareData 指标与降级', () => {
  it('产出 4 项指标：数值来自活动摘要且可复算', () => {
    const data = buildShareData(makeActivity(), [])

    expect(data.metrics.map((metric) => metric.value)).toEqual(['108.4', '4:12', '1268', '25.8'])
    expect(data.kicker).toContain('长距离')
    expect(data.headlineLines[0]).toBe('108.4 km骑行')
    expect(data.headlineLines[1]).toBe('爬升 1268 米')
  })

  it('缺失字段显示 — 而非 0（规格 §25）', () => {
    const data = buildShareData(
      makeActivity({ elevationGain: undefined, avgSpeed: undefined }),
      [],
    )

    expect(data.metrics.map((metric) => metric.value)).toContain('—')
    expect(data.metrics[2].value).toBe('—')
    expect(data.metrics[3].value).toBe('—')
    // 标题行降级：无爬升用时长补位
    expect(data.headlineLines[1]).toBe('4:12')
  })

  it('无名称活动标题回退「M 月 D 日 骑行」；bikeName 透传', () => {
    const data = buildShareData(makeActivity({ name: undefined, bikeName: '测试单车' }), [])

    // 回退标题按查看者本地时区格式化：期望值动态推导，避免 CI（UTC）与本机（UTC+8）日期跨天差异
    const local = new Date('2026-09-06T07:30:00+08:00')
    expect(data.title).toBe(`${local.getMonth() + 1} 月 ${local.getDate()} 日 骑行`)
    expect(data.bikeName).toBe('测试单车')
  })

  it('无坐标轨迹时 route 为空数组', () => {
    const data = buildShareData(makeActivity(), makeRecords(10))
    expect(data.route).toEqual([])
  })
})

describe('buildShareData 路线归一化', () => {
  it('带坐标轨迹归一化到 0..1 且等比（经度按纬度余弦压缩）', () => {
    const records = makeRecords(100, { withGeo: true, speedMps: 8 })
    const data = buildShareData(makeActivity(), records)

    expect(data.route.length).toBeGreaterThan(2)
    for (const point of data.route) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(1)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(1)
    }
    // 纬度跨度 = 经度跨度 × cos(30°)，等比缩放后纬度方向占满（归一化以长轴为基准）
    expect(data.routeSpanKm).toBeDefined()
    expect(data.routeSpanKm?.heightKm).toBeGreaterThan(0)
  })
})

describe('buildShareData 分段配速', () => {
  it('每 5 km 一段，段速 = 距离/时间（前快后慢可分辨），末段按真实里程', () => {
    // 前 5 km @10 m/s（50s/500m），后 5 km @5 m/s（50s/250m），采样间隔均为 50s
    const records: ActivityRecord[] = []
    let timestamp = 1_787_000_000
    let distance = 0
    for (let index = 0; index < 30; index += 1) {
      records.push({ timestamp, distance, speed: distance < 5000 ? 10 : 5 })
      timestamp += 50
      distance += distance < 5000 ? 500 : 250
    }
    records.push({ timestamp, distance: 10_000, speed: 5 })
    const data = buildShareData(
      makeActivity({ distance: 10_000, duration: 1500, avgSpeed: 24 / 3.6 }),
      records,
    )

    expect(data.splits).toBeDefined()
    const items = data.splits?.items ?? []
    expect(items.length).toBe(2)
    expect(items[0].lengthKm).toBeCloseTo(5, 1)
    expect(items[0].speedKmh).toBeCloseTo(36, 0)
    expect(items[1].speedKmh).toBeCloseTo(18, 0)
    expect(items[1].startKm).toBeCloseTo(5, 1)
    // 全程均速 = 距离/时间 = 10km / 1500s = 24 km/h（取摘要口径）
    expect(data.splits?.avgKmh).toBeCloseTo(24, 0)
  })

  it('记录缺口 >60s 不计入段内时间（停车不拉低段速）', () => {
    const records: ActivityRecord[] = []
    let timestamp = 1_787_000_000
    let distance = 0
    for (let index = 0; index <= 20; index += 1) {
      records.push({ timestamp, distance, speed: 10 })
      timestamp += index === 10 ? 600 : 30 // 中间停车 10 分钟
      distance += 300
    }
    const data = buildShareData(makeActivity({ distance: 6_000, duration: 660 }), records)

    const items = data.splits?.items ?? []
    // 6 km：缺口前 0-3km 一段；缺口后重起表，3-5、5-6 两段——停车 10 分钟不摊进任何一段
    expect(items.length).toBe(3)
    expect(items[0].speedKmh).toBeCloseTo(36, 0)
    expect(items[1].speedKmh).toBeCloseTo(36, 0)
    expect(items[2].speedKmh).toBeCloseTo(36, 0)
  })
})

describe('buildShareData 海拔剖面与爬坡分级', () => {
  it('采样海拔序列 + 累计爬升取摘要口径 + 爬升段分级', () => {
    // 后半程 8.3% 匀坡（采样后增益约 1000 m → HC），采样序列用于坡度判定
    const records = makeRecords(200, {
      speedMps: 8,
      altitude: (index) => (index > 100 ? 40 + (index - 100) * 20 : 40 + index * 0.2),
    })
    const data = buildShareData(makeActivity(), records)

    expect(data.elevation).toBeDefined()
    expect(data.elevation?.points.length).toBeLessThanOrEqual(121)
    // 展示口径取摘要 1268 m，不随采样密度漂移
    expect(data.elevation?.gainM).toBe(1268)
    const climbs = data.elevation?.climbs ?? []
    expect(climbs.length).toBeGreaterThan(0)
    expect(climbs.every((climb) => climb.gradePct > 3)).toBe(true)
    const labels = climbs.map((climb) => climb.label)
    expect(labels).toContain('HC')
  })

  it('无海拔数据时 elevation 为 undefined（不伪造图形）', () => {
    const data = buildShareData(makeActivity(), makeRecords(50))
    expect(data.elevation).toBeUndefined()
  })
})

describe('buildShareData 文案模板', () => {
  it('朋友圈文案：前 30 字含距离重点，数字与摘要一致', () => {
    const data = buildShareData(makeActivity(), [])
    expect(data.captions.moments).toContain('骑了 108.4 公里')
    expect(data.captions.moments).toContain('爬升 1268 米')
  })

  it('小红书标题 ≤20 字且含数字；正文每公里爬升可复算', () => {
    const data = buildShareData(makeActivity(), [])
    expect(data.captions.xhsTitle.length).toBeLessThanOrEqual(20)
    expect(data.captions.xhsTitle).toContain('108.4')
    // 1268 m / 108.4 km = 11.7 m/km
    expect(data.captions.xhsBody).toContain('平均每公里爬 11.7 m')
  })

  it('距离缺失时文案降级不出现假数字', () => {
    const data = buildShareData(makeActivity({ distance: undefined }), [])
    expect(data.captions.xhsTitle).not.toContain('km')
    expect(data.captions.moments).not.toContain('骑了')
  })
})
