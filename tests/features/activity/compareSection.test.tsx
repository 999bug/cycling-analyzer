/**
 * 活动对比区块测试。
 *
 * 选择对比活动后渲染：双轨迹地图（两条 polyline）+ 指标对比表（含差值）；
 * 未选择时仅渲染选择器。
 */
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import CompareSection from '@/features/activity/CompareSection'
import type { Activity, ActivityRecord } from '@/types/activity'

// 区块使用全局 db 单例：mock 模块导出独立的测试数据库实例
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入） */
const testDb = db

beforeEach(async () => {
  await testDb.activities.clear()
  await testDb.activity_records.clear()
  localStorage.clear()
  useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * 构造测试活动（含起终点坐标）。
 */
function makeActivity(
  id: string,
  name: string,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  distance: number,
  startTime: string,
): Activity {
  const records: ActivityRecord[] = [
    { timestamp: 0, latitude: startLat, longitude: startLng },
    { timestamp: 10, latitude: (startLat + endLat) / 2, longitude: (startLng + endLng) / 2 },
    { timestamp: 20, latitude: endLat, longitude: endLng },
  ]
  return {
    id,
    name,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime,
    endTime: '2026-08-01T09:00:00.000Z',
    duration: 3600,
    elapsedTime: 3600,
    distance,
    elevationGain: 100,
    avgSpeed: 8.33,
    avgHeartRate: 150,
    avgPower: 200,
    records,
  }
}

describe('活动对比区块', () => {
  it('未选择时仅渲染选择器（无地图/表格）', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000, '2026-08-01T08:00:00'), '机场东路')
    await repo.addActivity(makeActivity('a2', '顺义潮白河', 40.1, 116.3, 40.2, 116.4, 30000, '2026-08-02T08:00:00'), '顺义潮白河')

    render(<CompareSection activity={makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000, '2026-08-01T08:00:00')} records={[]} distanceUnit="km" />)

    expect(screen.getByText('活动对比')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('选择对比活动后渲染指标对比表（含差值列）', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000, '2026-08-01T08:00:00'), '机场东路')
    await repo.addActivity(makeActivity('a2', '顺义潮白河', 40.1, 116.3, 40.2, 116.4, 30000, '2026-08-02T08:00:00'), '顺义潮白河')
    const user = userEvent.setup()
    const current = makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000, '2026-08-01T08:00:00')

    render(<CompareSection activity={current} records={current.records ?? []} distanceUnit="km" />)

    // 等待对比活动选项加载完成后再选择
    const combo = await screen.findByRole('combobox')
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /顺义潮白河/ })).toBeInTheDocument()
    })
    await user.selectOptions(combo, 'a2')

    // 指标对比表：距离行（20000 vs 30000，差值 +10000m = +10.00 km）
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
    expect(screen.getByText('+10.00 km')).toBeInTheDocument()
    // 双轨迹地图（两条 polyline；Leaflet 异步挂载）
    await waitFor(() => {
      expect(document.querySelectorAll('.compare-section__map path.leaflet-interactive')).toHaveLength(2)
    })
  })
})
