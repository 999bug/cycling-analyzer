/**
 * 设备统计聚合测试（规格 §39 P2）。
 *
 * 验证：分组聚合、显示名回退链（产品名→型号→制造商→未知设备）、
 * 最近骑行时间取最大、次数降序与空输入边界。
 */
import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import type { DeviceInfo } from '@/types/activity'
import { buildDeviceStats, UNKNOWN_DEVICE_NAME } from '@/features/statistics/deviceStats'

/**
 * 生成活动摘要（仅设备统计相关字段有效）。
 *
 * @param id 活动 ID
 * @param device 设备信息
 * @param overrides 覆盖字段
 */
function makeSummary(
  id: string,
  device?: DeviceInfo,
  overrides: Partial<ActivitySummary> = {},
): ActivitySummary {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00.000Z',
    endTime: '2026-08-01T09:00:00.000Z',
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000,
    elevationGain: 200,
    device,
    ...overrides,
  } as ActivitySummary
}

describe('buildDeviceStats', () => {
  it('空输入返回空数组', () => {
    expect(buildDeviceStats([])).toEqual([])
  })

  it('按设备分组聚合并按次数降序', () => {
    const edge: DeviceInfo = { productName: 'Edge 840', manufacturer: 'Garmin' }
    const kickr: DeviceInfo = { productName: 'KICKR', manufacturer: 'Wahoo' }
    const entries = buildDeviceStats([
      makeSummary('a', edge, { distance: 30000, duration: 3600, elevationGain: 200 }),
      makeSummary('b', kickr, { distance: 20000, duration: 1800, elevationGain: 100 }),
      makeSummary('c', edge, {
        distance: 50000,
        duration: 5400,
        elevationGain: 500,
        startTime: '2026-08-05T08:00:00.000Z',
      }),
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      deviceName: 'Edge 840',
      count: 2,
      totalDistance: 80000,
      totalDuration: 9000,
      totalElevationGain: 700,
      lastRideTime: '2026-08-05T08:00:00.000Z',
    })
    expect(entries[1].deviceName).toBe('KICKR')
    expect(entries[1].count).toBe(1)
  })

  it('显示名回退链：产品名 → 型号 → 制造商 → 未知设备', () => {
    const entries = buildDeviceStats([
      makeSummary('a', { productName: 'Edge 840', product: '3421', manufacturer: 'Garmin' }),
      makeSummary('b', { product: '3421', manufacturer: 'Garmin' }),
      makeSummary('c', { manufacturer: 'Garmin' }),
      makeSummary('d', {}),
      makeSummary('e'),
    ])

    // 未知设备 2 次居首，其余各 1 次按显示名升序
    expect(entries.map((entry) => entry.deviceName)).toEqual([
      UNKNOWN_DEVICE_NAME,
      '3421',
      'Edge 840',
      'Garmin',
    ])
    // 无设备信息的两条活动归同一组
    expect(entries.find((entry) => entry.deviceName === UNKNOWN_DEVICE_NAME)?.count).toBe(2)
  })

  it('空白字符串字段视为缺失并继续回退', () => {
    const entries = buildDeviceStats([
      makeSummary('a', { productName: '  ', product: ' ', manufacturer: 'Garmin' }),
    ])

    expect(entries[0].deviceName).toBe('Garmin')
  })

  it('次数相同按显示名升序（输出稳定）', () => {
    const entries = buildDeviceStats([
      makeSummary('a', { productName: 'Zeta' }),
      makeSummary('b', { productName: 'Alpha' }),
    ])

    expect(entries.map((entry) => entry.deviceName)).toEqual(['Alpha', 'Zeta'])
  })
})
