/**
 * FIT 解码器测试（TDD：先写测试再实现）。
 * 样例：Garmin 官方公开样例 + 本地合成带 GPS 文件。
 */
import { describe, expect, it } from 'vitest'
import {
  CorruptedFitError,
  NotFitFileError,
  checkFitIntegrity,
  decodeFit,
  isFitFile,
} from '@/fit/decoder/fitDecoder'
import { randomBytes, readFixtureBytes } from '../helpers/fixtures'

/**
 * 构造 CRC 损坏的文件：复制有效 FIT 后翻转末尾两个字节。
 */
function tamperCrc(name: string): ArrayBuffer {
  const bytes = new Uint8Array(readFixtureBytes(name))
  const last = bytes.length - 1
  bytes[last] = bytes[last] ^ 0xff
  bytes[last - 1] = bytes[last - 1] ^ 0xff
  return bytes.buffer
}

describe('fitDecoder 文件识别', () => {
  it('识别合成骑行 FIT 为有效文件', () => {
    expect(isFitFile(readFixtureBytes('cycling-gps.fit'))).toBe(true)
  })

  it('识别官方样例为有效文件', () => {
    expect(isFitFile(readFixtureBytes('cookbook-activity.fit'))).toBe(true)
    expect(isFitFile(readFixtureBytes('lowbattery.fit'))).toBe(true)
  })

  it('随机字节不是 FIT 文件', () => {
    expect(isFitFile(randomBytes(1024))).toBe(false)
  })

  it('空文件不是 FIT 文件', () => {
    expect(isFitFile(new ArrayBuffer(0))).toBe(false)
  })
})

describe('fitDecoder 完整性校验', () => {
  it('有效 FIT 通过完整性校验', () => {
    expect(checkFitIntegrity(readFixtureBytes('cycling-gps.fit'))).toBe(true)
    expect(checkFitIntegrity(readFixtureBytes('lowbattery.fit'))).toBe(true)
  })

  it('CRC 被篡改的 FIT 校验失败', () => {
    expect(checkFitIntegrity(tamperCrc('cycling-gps.fit'))).toBe(false)
  })
})

describe('fitDecoder 解码', () => {
  it('解码合成骑行 FIT，得到完整数据', () => {
    const fit = decodeFit(readFixtureBytes('cycling-gps.fit'))

    expect(fit.fileId.type).toBe('activity')
    expect(fit.sessions.length).toBe(1)
    expect(fit.records.length).toBe(120)
  })

  it('解码记录包含时间、位置与各项指标', () => {
    const fit = decodeFit(readFixtureBytes('cycling-gps.fit'))
    const record = fit.records[60]

    expect(record.timestamp).toBe(1735689600 + 60 * 5)
    // 位置以半周存储（Normalizer 负责转十进制度）
    expect(record.positionLat).toBeGreaterThan(0)
    expect(record.positionLong).toBeGreaterThan(0)
    expect(record.distance).toBeCloseTo(1290, 1)
    expect(record.speed).toBeGreaterThan(0)
    expect(record.heartRate).toBeGreaterThan(0)
    expect(record.power).toBeGreaterThan(0)
    expect(record.cadence).toBeGreaterThan(0)
    expect(record.altitude).toBeGreaterThan(0)
  })

  it('解码官方低电量骑行样例（大量记录与功率数据）', () => {
    const fit = decodeFit(readFixtureBytes('lowbattery.fit'))

    expect(fit.records.length).toBe(3976)
    const withPower = fit.records.filter((r) => r.power !== undefined)
    expect(withPower.length).toBeGreaterThan(3000)
  })

  it('解码多会话样例得到 2 个 session', () => {
    const fit = decodeFit(readFixtureBytes('multisport.fit'))

    expect(fit.sessions.length).toBe(2)
  })

  it('解码心率样例（有心率无功率）', () => {
    const fit = decodeFit(readFixtureBytes('hrm-activity.fit'))
    const withHeartRate = fit.records.filter((r) => r.heartRate !== undefined)
    const withPower = fit.records.filter((r) => r.power !== undefined)

    expect(withHeartRate.length).toBeGreaterThan(100)
    expect(withPower.length).toBe(0)
  })

  it('解码合成功率样例（有功率无心率）', () => {
    const fit = decodeFit(readFixtureBytes('power-only.fit'))
    const withPower = fit.records.filter((r) => r.power !== undefined)
    const withHeartRate = fit.records.filter((r) => r.heartRate !== undefined)

    expect(withPower.length).toBe(120)
    expect(withHeartRate.length).toBe(0)
  })

  it('无 GPS 样例的记录不含有效位置（字段为 0）', () => {
    const fit = decodeFit(readFixtureBytes('cookbook-activity.fit'))

    expect(fit.records.length).toBe(3601)
    const hasPosition = fit.records.some(
      (r) => r.positionLat !== undefined && r.positionLat !== 0,
    )
    expect(hasPosition).toBe(false)
  })

  it('会话包含运动类型与统计信息', () => {
    const fit = decodeFit(readFixtureBytes('cycling-gps.fit'))
    const session = fit.sessions[0]

    expect(session.sport).toBe('cycling')
    expect(session.totalDistance).toBeCloseTo(2580, 0)
    expect(session.totalElapsedTime).toBe(600)
    expect(session.startTime).toBe(1735689600)
  })
})

describe('fitDecoder 错误处理', () => {
  it('非 FIT 文件解码抛出 NotFitFileError', () => {
    expect(() => decodeFit(randomBytes(1024))).toThrow(NotFitFileError)
  })

  it('空文件解码抛出 NotFitFileError', () => {
    expect(() => decodeFit(new ArrayBuffer(0))).toThrow(NotFitFileError)
  })

  it('CRC 损坏文件解码抛出 CorruptedFitError', () => {
    expect(() => decodeFit(tamperCrc('cycling-gps.fit'))).toThrow(
      CorruptedFitError,
    )
  })
})
