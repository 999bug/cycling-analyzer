/**
 * 骑行路线图页集成测试。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：
 * 空库 → 引导文案；不同路线 → 列表与地图轨迹渲染；
 * 相同路线聚类合并（次数累加）；点击列表选中/取消高亮；仓库异常 → 错误文案。
 */
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import RoutesMapPage from '@/pages/RoutesMapPage'
import type { Activity, ActivityRecord } from '@/types/activity'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

/** 空态引导文案 */
const EMPTY_GUIDE = /还没有可展示的骑行路线/

beforeEach(async () => {
  // 清空各表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
  await testDb.activity_records.clear()
  await testDb.scan_cache.clear()
  // 数据源复位：默认有效源为本地
  localStorage.clear()
  useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * 构造测试活动。
 *
 * @param id 活动 ID
 * @param name 活动标题
 * @param startLat 起点纬度（首点）
 * @param startLng 起点经度
 * @param endLat 终点纬度（末点）
 * @param endLng 终点经度
 * @param distance 距离（米）
 * @param startTime 开始时间（组内最近骑行命名路线，需互不相同）
 * @returns 活动（含逐点记录）
 */
function makeActivity(
  id: string,
  name: string,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  distance: number,
  startTime = '2026-08-01T08:00:00.000Z',
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

/** 注入活动到测试数据库（摘要 + 逐点，含标题） */
async function seedActivities(activities: Activity[]): Promise<void> {
  const repository = new DexieActivityRepository(testDb)
  for (const activity of activities) {
    // 生产流程导入时由标题还原传入 name，测试显式传递
    await repository.addActivity(activity, activity.name)
  }
}

describe('骑行路线图页', () => {
  it('空库显示引导文案', async () => {
    render(<RoutesMapPage />)

    expect(await screen.findByText(EMPTY_GUIDE)).toBeInTheDocument()
  })

  it('不同路线渲染列表与地图轨迹（相同路线聚类合并次数）', async () => {
    // 路线 A：a1/a2 相同起终点与距离（聚类为一条路线，2 次）；路线 B：b1 独立路线
    await seedActivities([
      makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000),
      makeActivity(
        'a2',
        '机场东路夜骑',
        31.2001,
        121.5001,
        31.3001,
        121.6001,
        20500,
        '2026-08-02T08:00:00.000Z',
      ),
      makeActivity('b1', '顺义潮白河', 40.1, 116.3, 40.2, 116.4, 30000),
    ])

    const { container } = render(<RoutesMapPage />)

    // 列表：两条路线（a 组按最近标题命名 + b 组），次数正确
    expect(await screen.findByText('机场东路夜骑')).toBeInTheDocument()
    expect(screen.getByText('顺义潮白河')).toBeInTheDocument()
    expect(screen.getByText('2 次')).toBeInTheDocument()
    expect(screen.getByText('1 次')).toBeInTheDocument()

    // 地图轨迹：3 条路线 × 2 层（白色光晕 + 彩色）= 6 条 polyline（Leaflet 异步挂载，等待就绪）
    await waitFor(() => {
      expect(
        container.querySelectorAll('.routes-map-page__map path.leaflet-interactive'),
      ).toHaveLength(6)
    })
  })

  it('点击路线列表选中高亮，再次点击取消', async () => {
    await seedActivities([makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000)])
    const user = userEvent.setup()

    render(<RoutesMapPage />)

    const item = await screen.findByRole('button', { name: /机场东路/ })
    expect(item.className).not.toContain('--active')

    await user.click(item)
    expect(item.className).toContain('--active')

    await user.click(item)
    expect(item.className).not.toContain('--active')
  })

  it('仓库异常显示错误文案', async () => {
    // 注入一个永远 reject 的仓库
    vi.spyOn(DexieActivityRepository.prototype, 'listAllSummaries').mockRejectedValue(
      new Error('boom'),
    )

    render(<RoutesMapPage />)

    expect(await screen.findByText(/路线加载失败/)).toBeInTheDocument()
  })
})
