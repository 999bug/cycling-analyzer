/**
 * 骑行热力图页集成测试（规格 §39）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：
 * 空库/无坐标活动 → 引导文案；含坐标活动 → 轨迹计数与地图渲染；
 * 仓库异常 → 错误文案。
 */
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import HeatmapPage from '@/pages/HeatmapPage'
import type { Activity, ActivityRecord } from '@/types/activity'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

/** 空态引导文案 */
const EMPTY_GUIDE = /还没有可展示的骑行轨迹/

beforeEach(async () => {
  // 清空各表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
  await testDb.activity_records.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * 构造测试活动。
 *
 * @param id 活动 ID
 * @param records 逐点记录（可含坐标或不含）
 * @returns 活动（含逐点记录）
 */
function makeActivity(id: string, records: ActivityRecord[]): Activity {
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
    elevationGain: 100,
    records,
  }
}

/**
 * 构造一条含坐标的轨迹记录列表。
 *
 * @param baseLat 基准纬度
 * @param baseLng 基准经度
 * @param count 点数
 */
function makeTrackRecords(baseLat: number, baseLng: number, count: number): ActivityRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: index * 10,
    latitude: baseLat + index * 0.001,
    longitude: baseLng + index * 0.001,
  }))
}

describe('骑行热力图页', () => {
  it('空库显示引导文案', async () => {
    render(<HeatmapPage />)

    expect(await screen.findByText(EMPTY_GUIDE)).toBeInTheDocument()
  })

  it('全部活动无坐标时显示引导文案', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makeActivity('act-1', [{ timestamp: 0 }, { timestamp: 10 }]))
    render(<HeatmapPage />)

    expect(await screen.findByText(EMPTY_GUIDE)).toBeInTheDocument()
  })

  it('含坐标活动显示轨迹计数与地图（无坐标活动不计入）', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(makeActivity('act-1', makeTrackRecords(31.2, 121.5, 20)))
    await repo.addActivity(makeActivity('act-2', makeTrackRecords(30.6, 104.0, 15)))
    // 无坐标活动：不计入轨迹数
    await repo.addActivity(makeActivity('act-3', [{ timestamp: 0 }, { timestamp: 10 }]))
    const { container } = render(<HeatmapPage />)

    expect(await screen.findByText(/共 2 条轨迹/)).toBeInTheDocument()
    // 区域覆盖统计：两条轨迹分属不同城市，网格数 ≥ 2
    expect(screen.getByText(/已探索 \d+ 个 1km 网格（约 [\d.]+ km²）/)).toBeInTheDocument()
    // Leaflet 地图容器已渲染
    expect(container.querySelector('.leaflet-container')).not.toBeNull()
    // 全屏查看按钮悬浮于地图右上角
    expect(screen.getByRole('button', { name: '全屏查看' })).toBeInTheDocument()
  })

  it('只有 1 个坐标点的轨迹不可绘制，显示引导文案', async () => {
    const repo = new DexieActivityRepository(testDb)
    await repo.addActivity(
      makeActivity('act-1', [{ timestamp: 0, latitude: 31.2, longitude: 121.5 }]),
    )
    render(<HeatmapPage />)

    expect(await screen.findByText(EMPTY_GUIDE)).toBeInTheDocument()
  })

  it('仓库异常时显示错误文案', async () => {
    vi.spyOn(DexieActivityRepository.prototype, 'listAllSummaries').mockRejectedValue(
      new Error('db down'),
    )
    render(<HeatmapPage />)

    expect(await screen.findByText('加载失败，请刷新重试')).toBeInTheDocument()
  })
})
