/**
 * 动态骑行洞察测试（buildRideInsights）。
 *
 * 构造各种数据场景（后程掉速/心率漂移/爬坡/长距离/配速波动/GPS 漂移/
 * 强度档位/数据缺失），验证洞察由真实数据条件生成、不足 3 条时概览兜底、
 * 排序（负面优先）与上限截断。
 */
import { describe, expect, it } from 'vitest'
import type { Activity, ActivityRecord } from '@/types/activity'
import { buildRideInsights } from '@/features/insights/rideInsights'

/** 基础活动摘要（各测试按需覆盖字段） */
function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'test-id',
    fileId: 'file-id',
    fileName: 'test.fit',
    fingerprint: 'fp',
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00+08:00',
    endTime: '2026-08-01T10:00:00+08:00',
    duration: 7200,
    elapsedTime: 7300,
    distance: 60000,
    elevationGain: 300,
    ...overrides,
  }
}

/** 生成 N 个匀速点 */
function uniformRecords(count: number, overrides: Partial<ActivityRecord> = {}): ActivityRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: index * 10,
    distance: index * 100,
    speed: 8,
    power: 200,
    heartRate: 150,
    latitude: 31.2 + index * 0.0001,
    longitude: 121.5 + index * 0.0001,
    ...overrides,
  }))
}

describe('buildRideInsights 骑行洞察', () => {
  it('后程掉速明显时生成负面衰减洞察（含前后速度数值）', () => {
    // 40 点：前 30% 速度 8，后 30% 速度 5.6（-30%）
    const records = uniformRecords(40).map((record) => {
      const ratio = record.distance! / 4000
      if (ratio >= 0.7) {
        return { ...record, speed: 5.6 }
      }
      return record
    })
    const insights = buildRideInsights(makeActivity(), records)

    const fade = insights.find((insight) => insight.key === 'fade')
    expect(fade).toBeDefined()
    expect(fade?.kind).toBe('negative')
    expect(fade?.title).toBe('后程衰减')
    expect(fade?.text).toContain('28.8')
    expect(fade?.text).toContain('20.2')
    // 负面洞察排在最前
    expect(insights[0].key).toBe('fade')
  })

  it('后程提速时生成正面负分段洞察', () => {
    const records = uniformRecords(40).map((record) => {
      const ratio = record.distance! / 4000
      if (ratio >= 0.7) {
        return { ...record, speed: 10 }
      }
      return record
    })
    const insights = buildRideInsights(makeActivity(), records)

    const fade = insights.find((insight) => insight.key === 'fade')
    expect(fade?.kind).toBe('positive')
    expect(fade?.title).toBe('负分段')
  })

  it('前后速度接近（±阈值内）不生成衰减洞察', () => {
    const records = uniformRecords(40).map((record) => {
      const ratio = record.distance! / 4000
      if (ratio >= 0.7) {
        return { ...record, speed: 7.8 } // -2.5%，低于 8% 阈值
      }
      return record
    })
    const insights = buildRideInsights(makeActivity(), records)

    expect(insights.find((insight) => insight.key === 'fade')).toBeUndefined()
  })

  it('后半程功率下降心率升高时生成心率漂移洞察（有氧解耦）', () => {
    // 前半：200W/140bpm（EF≈1.43）；后半：170W/155bpm（EF≈1.10，降 23%）
    const records = uniformRecords(40).map((record) => {
      if (record.distance! >= 2000) {
        return { ...record, power: 170, heartRate: 155 }
      }
      return { ...record, heartRate: 140 }
    })
    const insights = buildRideInsights(makeActivity(), records)

    const drift = insights.find((insight) => insight.key === 'cardiacDrift')
    expect(drift).toBeDefined()
    expect(drift?.kind).toBe('negative')
    expect(drift?.title).toBe('心率漂移')
    expect(drift?.text).toContain('有氧解耦')
  })

  it('每公里爬升超过阈值时生成爬坡日洞察', () => {
    // 60km 爬 1000m → 16.7m/km ≥ 15
    const activity = makeActivity({ distance: 60000, elevationGain: 1000 })
    const insights = buildRideInsights(activity, uniformRecords(40))

    const climbing = insights.find((insight) => insight.key === 'climbing')
    expect(climbing).toBeDefined()
    expect(climbing?.title).toBe('爬坡日')
    expect(climbing?.text).toContain('17')
    expect(climbing?.text).toContain('1000')
  })

  it('距离超过 80km 生成长距离洞察，短途不生成', () => {
    const long = buildRideInsights(makeActivity({ distance: 90000 }), uniformRecords(40))
    expect(long.find((insight) => insight.key === 'longRide')).toBeDefined()

    const short = buildRideInsights(makeActivity({ distance: 30000 }), uniformRecords(40))
    expect(short.find((insight) => insight.key === 'longRide')).toBeUndefined()
  })

  it('速度波动大时生成负面配速波动洞察', () => {
    const records = uniformRecords(40).map((record, index) => ({
      ...record,
      speed: index % 2 === 0 ? 14 : 2,
    }))
    const insights = buildRideInsights(makeActivity(), records)

    const pace = insights.find((insight) => insight.key === 'steadyPace')
    expect(pace?.kind).toBe('negative')
    expect(pace?.title).toBe('配速波动')
  })

  it('有 FTP 与功率时生成强度档位洞察（IF 口径）', () => {
    const activity = makeActivity({ avgPower: 160, normalizedPower: 170 })
    const insights = buildRideInsights(activity, uniformRecords(40), { ftp: 200 })

    const intensity = insights.find((insight) => insight.key === 'intensity')
    expect(intensity).toBeDefined()
    // NP 170 / FTP 200 = 85% → 节奏骑
    expect(intensity?.text).toContain('85%')
    expect(intensity?.text).toContain('节奏骑')
  })

  it('无 FTP 有最大心率时强度档位退化为心率占比口径', () => {
    const activity = makeActivity({ avgHeartRate: 135 })
    const insights = buildRideInsights(activity, uniformRecords(40), { maxHeartRate: 180 })

    const intensity = insights.find((insight) => insight.key === 'intensity')
    expect(intensity).toBeDefined()
    // 135/180 = 75% → 有氧骑
    expect(intensity?.text).toContain('75%')
    expect(intensity?.text).toContain('有氧骑')
  })

  it('FTP 与心率均缺失时不生成强度档位（不伪造）', () => {
    const insights = buildRideInsights(makeActivity(), uniformRecords(40))
    expect(insights.find((insight) => insight.key === 'intensity')).toBeUndefined()
  })

  it('GPS 漂移点被检测时生成数据质量洞察', () => {
    const records = uniformRecords(30)
    // 把中段一个点改到 1 度外的远坐标（两侧瞬时速度远超 50m/s → 飞点）
    records[15] = { ...records[15], latitude: 32.2, longitude: 122.5 }
    const insights = buildRideInsights(makeActivity(), records)

    const gps = insights.find((insight) => insight.key === 'gpsQuality')
    expect(gps).toBeDefined()
    expect(gps?.text).toContain('1 个 GPS 漂移点')
  })

  it('数据稀疏时用真实数据概览兜底（不伪造多余洞察）', () => {
    // 只有摘要、无逐点数据、无 FTP：仅概览一条（均为真实数据）
    const activity = makeActivity({ distance: 25000, elevationGain: 120, avgSpeed: 6.5 })
    const insights = buildRideInsights(activity, [])

    expect(insights).toHaveLength(1)
    const overview = insights.find((insight) => insight.key === 'overview')
    expect(overview).toBeDefined()
    expect(overview?.text).toContain('25.00 km')
    expect(overview?.text).toContain('2 小时')
    expect(overview?.text).toContain('120')
  })

  it('洞察上限 6 条且负面优先排序', () => {
    // 同时触发多条规则：掉速 + 心率漂移 + 配速波动 + 爬坡日 + 长距离 + 极速
    const records = uniformRecords(60).map((record, index) => {
      const ratio = record.distance! / 6000
      const mutated = { ...record }
      if (ratio >= 0.7) {
        mutated.speed = 4
        mutated.power = 150
        mutated.heartRate = 165
      } else {
        mutated.heartRate = 140
      }
      if (index % 3 === 0) {
        mutated.speed = 12
      }
      return mutated
    })
    const activity = makeActivity({
      distance: 90000,
      elevationGain: 1400,
      maxSpeed: 18,
    })
    const insights = buildRideInsights(activity, records)

    expect(insights.length).toBeLessThanOrEqual(6)
    // 前 3 条应为负面（fade/cardiacDrift/steadyPace 任一在前）
    expect(insights[0].kind).toBe('negative')
  })

  it('英里单位时距离/速度随单位换算', () => {
    const activity = makeActivity({ distance: 90000 })
    const insights = buildRideInsights(activity, uniformRecords(40), { distanceUnit: 'mi' })

    const long = insights.find((insight) => insight.key === 'longRide')
    expect(long?.text).toContain('mi')
  })

  it('距离与时长全缺时返回空数组（不伪造）', () => {
    const activity = makeActivity({ distance: 0, duration: 0, elevationGain: undefined })
    const insights = buildRideInsights(activity, [])
    expect(insights).toEqual([])
  })

  it('极速超过阈值时生成极速洞察', () => {
    const activity = makeActivity({ maxSpeed: 17 })
    const insights = buildRideInsights(activity, uniformRecords(40))

    const top = insights.find((insight) => insight.key === 'topSpeed')
    expect(top).toBeDefined()
    expect(top?.text).toContain('61.2')
  })

  it('平均踏频低于 65 时生成踏频偏低洞察', () => {
    const records = uniformRecords(40).map((record) => ({ ...record, cadence: 55 }))
    const insights = buildRideInsights(makeActivity(), records)

    const cadence = insights.find((insight) => insight.key === 'cadence')
    expect(cadence).toBeDefined()
    expect(cadence?.kind).toBe('info')
    expect(cadence?.title).toBe('踏频偏低')
    expect(cadence?.text).toContain('55')
  })

  it('踏频高且波动小时生成踏频稳定洞察', () => {
    // 88~92 rpm 交替，均值 90、CV 远低于 15%
    const records = uniformRecords(40).map((record, index) => ({
      ...record,
      cadence: index % 2 === 0 ? 88 : 92,
    }))
    const insights = buildRideInsights(makeActivity(), records)

    const cadence = insights.find((insight) => insight.key === 'cadence')
    expect(cadence?.kind).toBe('positive')
    expect(cadence?.title).toBe('踏频稳定')
  })

  it('滑行零踏频不参与统计，全滑行时不生成踏频洞察', () => {
    const records = uniformRecords(40).map((record) => ({ ...record, cadence: 0 }))
    const insights = buildRideInsights(makeActivity(), records)
    expect(insights.find((insight) => insight.key === 'cadence')).toBeUndefined()
  })

  it('NP 接近均功率时生成输出平顺洞察（VI ≤ 1.05）', () => {
    const activity = makeActivity({ avgPower: 200, normalizedPower: 208 })
    const insights = buildRideInsights(activity, [])

    const vi = insights.find((insight) => insight.key === 'variabilityIndex')
    expect(vi).toBeDefined()
    expect(vi?.kind).toBe('positive')
    expect(vi?.title).toBe('输出平顺')
    expect(vi?.text).toContain('1.04')
  })

  it('NP 明显高于均功率时生成输出波动洞察（VI ≥ 1.15）', () => {
    const activity = makeActivity({ avgPower: 200, normalizedPower: 245 })
    const insights = buildRideInsights(activity, uniformRecords(40))

    const vi = insights.find((insight) => insight.key === 'variabilityIndex')
    expect(vi?.kind).toBe('info')
    expect(vi?.title).toBe('输出波动')
  })

  it('VI 处于中间区间不生成变动指数洞察', () => {
    const activity = makeActivity({ avgPower: 200, normalizedPower: 220 })
    const insights = buildRideInsights(activity, uniformRecords(40))
    expect(insights.find((insight) => insight.key === 'variabilityIndex')).toBeUndefined()
  })

  it('20 分钟峰值功率接近 FTP 时生成正面峰值功率洞察', () => {
    // 10s 采样 150 点：20 分钟窗口 = 120 样本，可用
    const records = uniformRecords(150).map((record) => ({ ...record, power: 195 }))
    const insights = buildRideInsights(makeActivity(), records, { ftp: 200 })

    const peak = insights.find((insight) => insight.key === 'peakPower')
    expect(peak).toBeDefined()
    expect(peak?.kind).toBe('positive')
    expect(peak?.text).toContain('195')
    expect(peak?.text).toContain('98%')
  })

  it('5 分钟峰值功率亮眼（≥110% FTP）时生成峰值功率洞察', () => {
    // 10s 采样 40 点：20 分钟窗口样本不足退到 5 分钟（30 样本可用）
    const records = uniformRecords(40).map((record) => ({ ...record, power: 230 }))
    const insights = buildRideInsights(makeActivity(), records, { ftp: 200 })

    const peak = insights.find((insight) => insight.key === 'peakPower')
    expect(peak).toBeDefined()
    expect(peak?.kind).toBe('info')
    expect(peak?.text).toContain('5 分钟')
  })

  it('无 FTP 或峰值不亮眼时不生成峰值功率洞察', () => {
    // 100W 对 FTP 120 仅 83%，各窗口均低于阈值
    const records = uniformRecords(150).map((record) => ({ ...record, power: 100 }))
    expect(
      buildRideInsights(makeActivity(), records).find(
        (insight) => insight.key === 'peakPower',
      ),
    ).toBeUndefined()
    expect(
      buildRideInsights(makeActivity(), records, { ftp: 120 }).find(
        (insight) => insight.key === 'peakPower',
      ),
    ).toBeUndefined()
  })

  it('阈值以上输出时间占比达到 10% 时生成阈值输出洞察', () => {
    const records = uniformRecords(40).map((record) => ({ ...record, power: 210 }))
    const insights = buildRideInsights(makeActivity(), records, { ftp: 200 })

    const threshold = insights.find((insight) => insight.key === 'thresholdTime')
    expect(threshold).toBeDefined()
    expect(threshold?.kind).toBe('info')
    expect(threshold?.title).toBe('阈值输出')
    expect(threshold?.text).toContain('100%')
  })

  it('停走样本占比高时生成频繁停走洞察', () => {
    const records = uniformRecords(80).map((record, index) => ({
      ...record,
      speed: index % 2 === 0 ? 8 : 0.3,
    }))
    const insights = buildRideInsights(makeActivity(), records)

    const stopGo = insights.find((insight) => insight.key === 'stopGo')
    expect(stopGo).toBeDefined()
    expect(stopGo?.kind).toBe('info')
    expect(stopGo?.title).toBe('频繁停走')
    expect(stopGo?.text).toContain('50%')
  })

  it('几乎不停歇时生成节奏连贯洞察', () => {
    const records = uniformRecords(80)
    const insights = buildRideInsights(makeActivity(), records)

    const stopGo = insights.find((insight) => insight.key === 'stopGo')
    expect(stopGo?.kind).toBe('positive')
    expect(stopGo?.title).toBe('节奏连贯')
  })

  it('爬坡时间占比高时生成地形构成洞察', () => {
    // 相邻点海拔 +4m / 距离 +100m → 恒定 4% 爬坡
    const records = uniformRecords(60).map((record, index) => ({
      ...record,
      altitude: index * 4,
    }))
    const insights = buildRideInsights(makeActivity(), records)

    const terrain = insights.find((insight) => insight.key === 'terrain')
    expect(terrain).toBeDefined()
    expect(terrain?.kind).toBe('info')
    expect(terrain?.title).toBe('地形构成')
    expect(terrain?.text).toContain('爬坡')
  })

  it('海拔数据覆盖不足时不生成地形构成洞察', () => {
    const records = uniformRecords(40).map((record, index) => ({
      ...record,
      altitude: index * 4,
    }))
    const insights = buildRideInsights(makeActivity(), records)
    expect(insights.find((insight) => insight.key === 'terrain')).toBeUndefined()
  })

  it('均速快于近期均值 5% 以上时生成正面近期对比洞察', () => {
    const activity = makeActivity({ avgSpeed: 7 })
    const insights = buildRideInsights(activity, uniformRecords(40), {
      recentBaseline: { sampleCount: 10, avgSpeed: 6 },
    })

    const compare = insights.find((insight) => insight.key === 'recentCompare')
    expect(compare).toBeDefined()
    expect(compare?.kind).toBe('positive')
    expect(compare?.title).toBe('近期对比')
    expect(compare?.text).toContain('10 次')
  })

  it('均速慢于近期均值 8% 以上时生成中性近期对比洞察', () => {
    const activity = makeActivity({ avgSpeed: 5 })
    const insights = buildRideInsights(activity, uniformRecords(40), {
      recentBaseline: { sampleCount: 8, avgSpeed: 6 },
    })

    const compare = insights.find((insight) => insight.key === 'recentCompare')
    expect(compare?.kind).toBe('info')
    expect(compare?.text).toContain('慢')
  })

  it('基线缺失、样本不足或差异不显著时不生成近期对比洞察', () => {
    const activity = makeActivity({ avgSpeed: 6.1 })
    // 基线缺省
    expect(
      buildRideInsights(activity, uniformRecords(40)).find(
        (insight) => insight.key === 'recentCompare',
      ),
    ).toBeUndefined()
    // 样本不足（< 5）
    expect(
      buildRideInsights(activity, uniformRecords(40), {
        recentBaseline: { sampleCount: 3, avgSpeed: 6 },
      }).find((insight) => insight.key === 'recentCompare'),
    ).toBeUndefined()
    // 差异 ±1.7% 不显著
    expect(
      buildRideInsights(activity, uniformRecords(40), {
        recentBaseline: { sampleCount: 10, avgSpeed: 6 },
      }).find((insight) => insight.key === 'recentCompare'),
    ).toBeUndefined()
  })
})
