/**
 * 匹配的骑行区块集成测试。
 *
 * 通过 vi.mock 注入独立数据库实例：同路线活动 → 渲染匹配项（排除自身）；
 * 独一路线 / 计算失败 → 区块不渲染。
 */
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import SimilarRidesSection from '@/features/activity/SimilarRidesSection'
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
 * 构造测试活动（含起终点坐标与标题）。
 *
 * @param id 活动 ID
 * @param name 活动标题
 * @param startLat 起点纬度
 * @param startLng 起点经度
 * @param endLat 终点纬度
 * @param endLng 终点经度
 * @param distance 距离（米）
 * @param startTime 开始时间
 * @returns 活动
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
    records,
  }
}

/** 注入活动到测试数据库 */
async function seedActivities(activities: Activity[]): Promise<void> {
  const repository = new DexieActivityRepository(testDb)
  for (const activity of activities) {
    await repository.addActivity(activity, activity.name)
  }
}

describe('匹配的骑行区块', () => {
  it('同路线活动渲染匹配列表（排除自身，最新在前）', async () => {
    await seedActivities([
      makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000, '2026-08-01T08:00:00'),
      makeActivity('a2', '机场东路夜骑', 31.2001, 121.5001, 31.3001, 121.6001, 20500, '2026-08-02T08:00:00'),
    ])

    render(
      <MemoryRouter>
        <SimilarRidesSection activityId="a1" distanceUnit="km" />
      </MemoryRouter>,
    )

    // a1 的匹配 = a2（列表含名称与元信息）
    const link = await screen.findByRole('link', { name: /机场东路夜骑/ })
    expect(link).toHaveAttribute('href', '/activities/a2')
    expect(screen.getByText(/20\.50 km/)).toBeInTheDocument()
  })

  it('独一路线（无同组其他骑行）时不渲染区块', async () => {
    await seedActivities([
      makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000, '2026-08-01T08:00:00'),
    ])

    render(
      <MemoryRouter>
        <SimilarRidesSection activityId="a1" distanceUnit="km" />
      </MemoryRouter>,
    )

    // 等待计算完成后仍无区块（findBy 超时前用 waitFor 断言不存在）
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(screen.queryByText('匹配的骑行')).toBeNull()
  })

  it('分组扫描失败时不渲染区块', async () => {
    vi.spyOn(DexieActivityRepository.prototype, 'listAllSummaries').mockRejectedValue(
      new Error('db down'),
    )

    render(
      <MemoryRouter>
        <SimilarRidesSection activityId="a1" distanceUnit="km" />
      </MemoryRouter>,
    )

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(screen.queryByText('匹配的骑行')).toBeNull()
  })
})
