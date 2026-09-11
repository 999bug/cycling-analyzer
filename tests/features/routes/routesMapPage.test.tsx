/**
 * 骑行路线图页集成测试。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：
 * 空库 → 引导文案；不同路线 → 列表与地图轨迹渲染；
 * 相同路线聚类合并（次数累加）；点击列表选中/取消高亮；仓库异常 → 错误文案；
 * 右下角底图模式切换 → 仅当前页生效（不写 localStorage，刷新回到「正常」）。
 */
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import RoutesMapPage from '@/pages/RoutesMapPage'
import { ALL_CURATED_ROUTES, CURATED_REGIONS } from '@/features/curatedRoutes'
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
  // 瓦片源降级记忆（sessionStorage）复位，避免上一个用例的 OSM 降级串味
  sessionStorage.clear()
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

  it('底部信息区展示路线总览，选中后显示当前路线名', async () => {
    await seedActivities([
      makeActivity('a1', '机场东路', 31.2, 121.5, 31.3, 121.6, 20000),
      makeActivity('b1', '顺义潮白河', 40.1, 116.3, 40.2, 116.4, 30000),
    ])
    const user = userEvent.setup()

    render(<RoutesMapPage />)

    // 路线数 / 累计次数 / 覆盖里程（两条轨迹各约 14km 与 14km）
    await screen.findByRole('button', { name: /机场东路/ })
    expect(screen.getByText('2 条')).toBeInTheDocument()
    expect(screen.getByText('2 次')).toBeInTheDocument()
    expect(screen.getByText(/^\d+(\.\d+)? km$/)).toBeInTheDocument()
    // 「当前选中」这一项（列表里也有同名路线名，故按标签定位到统计项）
    const currentStat = screen.getByText('当前选中').parentElement
    expect(currentStat).toHaveTextContent('全部路线')

    await user.click(screen.getByRole('button', { name: /机场东路/ }))
    expect(currentStat).toHaveTextContent('机场东路')
  })

  it('仓库异常显示错误文案', async () => {
    // 注入一个永远 reject 的仓库
    vi.spyOn(DexieActivityRepository.prototype, 'listAllSummaries').mockRejectedValue(
      new Error('boom'),
    )

    render(<RoutesMapPage />)

    expect(await screen.findByText(/路线加载失败/)).toBeInTheDocument()
  })

  it('右下角底图模式控件：默认正常，切换卫星+路网只在当前页生效（不写记忆）', async () => {
    // 开始时间与本文件其它用例区分：路线扫描缓存键含开始时间，换值可避免命中上一个用例的缓存
    await seedActivities([
      makeActivity('sat-1', '滨江夜骑', 31.2, 121.5, 31.3, 121.6, 20000, '2026-08-05T08:00:00.000Z'),
    ])
    const user = userEvent.setup()

    render(<RoutesMapPage />)

    await screen.findByRole('button', { name: /滨江夜骑/ })
    expect(screen.getByRole('button', { name: '正常' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '卫星+路网' }))

    expect(screen.getByRole('button', { name: '卫星+路网' })).toHaveAttribute('aria-pressed', 'true')
    // 2.62.0 起底图模式不持久化：刷新/换页回到「正常」，不写 localStorage
    expect(localStorage.getItem('cycling-map-mode')).toBeNull()
  })
})

describe('骑行路线图页 · 热门路线板块', () => {
  it('切到热门路线：地区 chips 与卡片渲染，点击卡片显示详情侧栏（来源等级 + 免责声明）', async () => {
    const user = userEvent.setup()

    render(<RoutesMapPage />)

    // 顶部大分区切换 → 热门路线
    await user.click(screen.getByRole('button', { name: /热门路线/ }))

    // 地区 chips：全部 + 各地区（北京 22 条 + 全国 6 条）
    expect(screen.getByRole('button', { name: `全部 · ${ALL_CURATED_ROUTES.length}` }))
      .toBeInTheDocument()
    const beijingCount = CURATED_REGIONS.find((region) => region.id === 'beijing')!.routes.length
    expect(screen.getByRole('button', { name: `北京 · ${beijingCount}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '西安 · 1' })).toBeInTheDocument()

    // 卡片列表：一期妙峰山可见，难度标签渲染（前缀匹配，避免命中描述提到妙峰山的其他卡片）
    const card = screen.getByRole('button', { name: /^妙峰山/ })
    expect(card).toBeInTheDocument()

    // 点击卡片 → 详情侧栏：描述、来源等级标注与免责声明
    await user.click(card)
    expect(screen.getByText(/来源（官方口径）：门头沟区政府/)).toBeInTheDocument()
    expect(screen.getByText(/路径线为 OSM 简化示意，导航以实际道路为准/)).toBeInTheDocument()

    // 再次点击卡片 → 取消选中，详情回到提示态
    await user.click(card)
    expect(screen.getByText(/点击路线卡片在地图上单独高亮并查看详情/)).toBeInTheDocument()
  })

  it('地区筛选 chips：切换地区清空选中态，卡片仍按地区渲染', async () => {
    const user = userEvent.setup()
    const beijingCount = CURATED_REGIONS.find((region) => region.id === 'beijing')!.routes.length

    render(<RoutesMapPage />)

    await user.click(screen.getByRole('button', { name: /热门路线/ }))

    // 先选中一张卡片（详情出现），再切地区 chip → 选中态清空回提示态
    const card = screen.getByRole('button', { name: /^妙峰山/ })
    await user.click(card)
    expect(screen.getByText(/来源（官方口径）：门头沟区政府/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `北京 · ${beijingCount}` }))

    expect(screen.getByText(/点击路线卡片在地图上单独高亮并查看详情/)).toBeInTheDocument()
    // 卡片仍渲染（北京筛选命中妙峰山）
    expect(screen.getByRole('button', { name: /^妙峰山/ })).toBeInTheDocument()
    // 西安 chip 筛选后只剩秦岭分水岭一张卡，妙峰山不再显示
    await user.click(screen.getByRole('button', { name: '西安 · 1' }))
    expect(screen.getByRole('button', { name: /^秦岭分水岭/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^妙峰山/ })).not.toBeInTheDocument()
  })
})
