/**
 * FIT 标准化测试：解码结果 → 领域模型 Activity。
 */
import { describe, expect, it } from 'vitest'
import { decodeFit } from '@/fit/decoder/fitDecoder'
import { normalizeActivity, type NormalizeMeta } from '@/fit/normalizer/normalizer'
import { readFixtureBytes } from '../helpers/fixtures'

const META: NormalizeMeta = {
  id: 'test-activity-1',
  fileName: 'cycling-gps.fit',
  fingerprint: 'abc123',
}

function normalizeFixture(name: string) {
  const fit = decodeFit(readFixtureBytes(name))
  return normalizeActivity(fit, { ...META, fileName: name })
}

describe('normalizeActivity 基本信息', () => {
  it('提取运动类型与设备信息', () => {
    const activity = normalizeFixture('cycling-gps.fit')

    expect(activity.id).toBe('test-activity-1')
    expect(activity.fileName).toBe('cycling-gps.fit')
    expect(activity.fingerprint).toBe('abc123')
    expect(activity.activityType).toBe('cycling')
    expect(activity.fileId).toBe('42420001-1735689600')
    expect(activity.device?.productName).toBe('Cycling Analyzer Test Device')
  })

  it('转换开始/结束时间为 ISO 字符串', () => {
    const activity = normalizeFixture('cycling-gps.fit')

    expect(activity.startTime).toBe('2025-01-01T00:00:00.000Z')
    // 结束时间取会话结束（设备汇总），晚于末条记录 5 秒
    expect(activity.endTime).toBe('2025-01-01T00:10:00.000Z')
  })

  it('多会话文件取第一个会话的运动类型', () => {
    const activity = normalizeFixture('multisport.fit')

    expect(activity.activityType).toBe('cycling')
  })
})

describe('normalizeActivity 记录转换', () => {
  it('半周位置转换为十进制度', () => {
    const activity = normalizeFixture('cycling-gps.fit')
    const record = activity.records![60]

    expect(record.latitude).toBeCloseTo(39.9042, 5)
    expect(record.longitude).toBeCloseTo(116.4254, 5)
  })

  it('记录时间为 Unix 秒', () => {
    const activity = normalizeFixture('cycling-gps.fit')

    expect(activity.records![0].timestamp).toBe(1735689600)
    expect(activity.records![119].timestamp).toBe(1735689600 + 119 * 5)
  })

  it('无 GPS 样例记录不含经纬度', () => {
    const activity = normalizeFixture('cookbook-activity.fit')

    expect(activity.records![0].latitude).toBeUndefined()
    expect(activity.records![0].longitude).toBeUndefined()
  })

  it('无功率样例记录 power 为 undefined', () => {
    const activity = normalizeFixture('hrm-activity.fit')

    expect(activity.records![0].power).toBeUndefined()
    expect(activity.records![0].heartRate).toBeDefined()
  })

  it('无心率样例记录 heartRate 为 undefined', () => {
    const activity = normalizeFixture('power-only.fit')

    expect(activity.records![0].heartRate).toBeUndefined()
    expect(activity.records![0].power).toBeDefined()
  })
})

describe('normalizeActivity 统计字段', () => {
  it('合成骑行样例统计字段与记录一致', () => {
    const activity = normalizeFixture('cycling-gps.fit')

    expect(activity.duration).toBe(600)
    expect(activity.elapsedTime).toBe(600)
    expect(activity.distance).toBeCloseTo(2558.5, 1)
    expect(activity.elevationGain).toBeGreaterThan(30)
    expect(activity.avgSpeed).toBeCloseTo(4.264, 2)
    expect(activity.maxSpeed).toBeGreaterThan(8.9)
    expect(activity.avgHeartRate).toBeGreaterThan(128)
    expect(activity.avgHeartRate).toBeLessThan(136)
    // Encoder 整型截断：最大心率写入 149
    expect(activity.maxHeartRate).toBe(149)
    // 合成数据功率为正弦波动（周期非整数，均值略偏离 208）
    expect(activity.avgPower).toBeGreaterThan(205)
    expect(activity.avgPower).toBeLessThan(215)
    // Encoder 整型截断：最大功率写入 253
    expect(activity.maxPower).toBe(253)
    expect(activity.avgCadence).toBeCloseTo(86, 0)
    expect(activity.calories).toBe(456)
  })

  it('无心率样例心率统计为 undefined 而非 0', () => {
    const activity = normalizeFixture('power-only.fit')

    expect(activity.avgHeartRate).toBeUndefined()
    expect(activity.maxHeartRate).toBeUndefined()
    expect(activity.avgPower).toBeDefined()
  })

  it('无功率样例功率统计为 undefined 而非 0', () => {
    const activity = normalizeFixture('hrm-activity.fit')

    expect(activity.avgPower).toBeUndefined()
    expect(activity.maxPower).toBeUndefined()
    expect(activity.avgHeartRate).toBeDefined()
  })
})
