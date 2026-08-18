/**
 * 活动详情页训练分析集成测试（规格 §16/§17/§26）。
 *
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：造带功率/心率/踏频/坐标数据，
 * 断言踏频图/组合图挂载、轨迹着色切换按钮组、无 FTP/最大心率时引导文案、
 * 配置 FTP/最大心率后显示区间分布与 IF/TSS、标准化功率卡。
 * 设置经 saveSettings（默认仓库指向被 mock 的 db）写入。
 */
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { saveSettings } from '@/features/settings/settings'
import ActivityDetailPage from '@/pages/ActivityDetailPage'
import type { Activity, ActivityRecord } from '@/types/activity'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

beforeEach(async () => {
  // 清空全部表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
  await testDb.activity_records.clear()
  await testDb.settings.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * 构造测试活动：间隔 10 秒的逐点数据，带坐标/速度/心率/踏频/功率。
 * 各区段时长归属当前记录值：段 i = (t_i - t_{i-1})，归 records[i] 的指标值。
 *
 * @param id 活动 ID
 * @param powers 各点功率（W，undefined = 缺失）
 * @param heartRates 各点心率（bpm，undefined = 缺失）
 * @param overrides 覆盖字段（如 records 全量替换）
 * @returns 活动（含 records）
 */
function makeActivity(
  id: string,
  powers: Array<number | undefined>,
  heartRates: Array<number | undefined>,
  overrides: Partial<Activity> = {},
): Activity {
  const records: ActivityRecord[] = powers.map((power, i) => ({
    timestamp: i * 10,
    latitude: 31.2 + i * 0.001,
    longitude: 121.5 + i * 0.001,
    altitude: 10 + i,
    distance: i * 100,
    speed: 8 + i,
    heartRate: heartRates[i],
    cadence: 80 + i,
    power,
  }))
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00.000Z',
    endTime: '2026-08-01T08:00:40.000Z',
    duration: 40,
    elapsedTime: 40,
    distance: 400,
    elevationGain: 4,
    avgSpeed: 10,
    avgHeartRate: 150,
    avgPower: 200,
    avgCadence: 82,
    calories: 50,
    records,
    ...overrides,
  }
}

/** 渲染详情页（MemoryRouter + /activities/:id 路由） */
function renderPage(id = 'act-1') {
  return render(
    <MemoryRouter initialEntries={[`/activities/${id}`]}>
      <Routes>
        <Route path="/activities/:id" element={<ActivityDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('活动详情页训练分析集成', () => {
  let repo: DexieActivityRepository
  const user = userEvent.setup()

  beforeEach(() => {
    repo = new DexieActivityRepository(testDb)
    // jsdom 中 getBoundingClientRect 恒为 0，mock 容器尺寸让 Recharts 正常渲染
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 220,
    } as DOMRect)
  })

  it('挂载踏频图与速度+心率组合图', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200, 300, 200, 100], [120, 140, 160, 150, 130]))
    renderPage()

    // 组合图标题（'速度 + 心率'）与踏频标题（区别于指标卡'平均踏频'）
    expect(await screen.findByText('速度 + 心率')).toBeInTheDocument()
    expect(screen.getByText('踏频')).toBeInTheDocument()
    expect(screen.queryByText('该活动没有踏频数据')).not.toBeInTheDocument()
  })

  it('无踏频/速度/心率数据时图表显示空态提示', async () => {
    // 仅功率数据：踏频图/速度+心率组合图均无对应指标
    const records: ActivityRecord[] = [
      { timestamp: 0, power: 200 },
      { timestamp: 10, power: 220 },
    ]
    await repo.addActivity(
      makeActivity('act-1', [200, 220], [undefined, undefined], { records }),
    )
    renderPage()

    expect(await screen.findByText('该活动没有踏频数据')).toBeInTheDocument()
    expect(screen.getByText('该活动没有速度和心率数据')).toBeInTheDocument()
  })

  it('轨迹着色切换按钮组：默认选中，点击切换高亮', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200, 300, 200, 100], [120, 140, 160, 150, 130]))
    renderPage()

    // 全部 5 个模式按钮存在，默认选中"默认"
    const noneButton = await screen.findByRole('button', { name: '默认' })
    expect(noneButton).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['速度', '心率', '功率', '海拔']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }

    // 点击"速度"→ 高亮切换
    await user.click(screen.getByRole('button', { name: '速度' }))
    expect(screen.getByRole('button', { name: '速度' })).toHaveAttribute('aria-pressed', 'true')
    expect(noneButton).toHaveAttribute('aria-pressed', 'false')

    // 点击"心率"→ 高亮再次切换，速度取消
    await user.click(screen.getByRole('button', { name: '心率' }))
    expect(screen.getByRole('button', { name: '心率' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '速度' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('有功率数据时标准化功率卡显示 NP，无功率数据时显示占位符', async () => {
    // 恒 200W、跨度 40 秒 → NP = 200 W
    await repo.addActivity(makeActivity('act-1', [200, 200, 200, 200, 200], [120, 140, 160, 150, 130]))
    const first = renderPage()

    const npCard = (await screen.findByText('标准化功率')).closest('.activity-detail__stat-card')
    expect(npCard).not.toBeNull()
    expect(npCard).toHaveTextContent('200 W')

    // 无功率数据（仅心率）：标准化功率卡显示 '—'
    first.unmount()
    await repo.addActivity(
      makeActivity('act-2', [undefined, undefined, undefined, undefined, undefined], [120, 140, 160, 150, 130]),
    )
    renderPage('act-2')

    const npCardEmpty = (await screen.findByText('标准化功率')).closest('.activity-detail__stat-card')
    expect(npCardEmpty).not.toBeNull()
    expect(npCardEmpty).toHaveTextContent('—')
  })

  it('未配置 FTP/最大心率时训练区间区显示引导文案', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200, 300, 200, 100], [120, 140, 160, 150, 130]))
    renderPage()

    expect(
      await screen.findByText('在设置中配置 FTP 与最大心率后可查看区间分析'),
    ).toBeInTheDocument()
    expect(screen.queryByText('心率区间')).not.toBeInTheDocument()
    expect(screen.queryByText('功率区间')).not.toBeInTheDocument()
  })

  it('训练区间区块展示「计算方式说明」折叠块（含区间边界与 IF/TSS 公式）', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200, 300, 200, 100], [120, 140, 160, 150, 130]))
    renderPage()

    const zonesSection = await screen.findByRole('region', { name: '训练区间' })
    expect(within(zonesSection).getByText('计算方式说明')).toBeInTheDocument()
    expect(within(zonesSection).getByText(/心率区间：按最大心率百分比划分/)).toBeInTheDocument()
    expect(within(zonesSection).getByText(/功率区间：按 FTP 百分比划分/)).toBeInTheDocument()
    expect(within(zonesSection).getByText(/强度因子（IF）= NP ÷ FTP/)).toBeInTheDocument()
    expect(within(zonesSection).getByText(/训练压力分数（TSS）=/)).toBeInTheDocument()
  })

  it('配置 FTP/最大心率后显示心率与功率区间分布（区间归属正确）', async () => {
    // maxHR=180、ftp=200。记录：hr=[120,150,180,120,150]、power=[100,110,150,210,100]
    // 段归属（归当前记录值）：
    // 心率：120→Z2、150（83.3%）→Z4、180→Z5、120→Z2、150→Z4
    // 功率：110（55%）→Z2、150（75%）→Z3、210（105%）→Z5、100（50%）→Z1
    // 各段 10 秒：心率 Z2 10s、Z4 20s、Z5 10s；功率 Z1/Z2/Z3/Z5 各 10s
    await repo.addActivity(
      makeActivity('act-1', [100, 110, 150, 210, 100], [120, 150, 180, 120, 150]),
    )
    await saveSettings({ profile: { ftp: 200, maxHeartRate: 180 } })
    renderPage()

    expect(await screen.findByText('心率区间')).toBeInTheDocument()
    expect(screen.getByText('功率区间')).toBeInTheDocument()

    // 心率：Z2 耐力区 10 秒 25%、Z3 有氧区 0 秒、Z4 阈值区 20 秒 50%
    const heartZ2 = screen.getByText('Z2 耐力区').closest('.zone-row')
    expect(heartZ2).toHaveTextContent('00:00:10')
    expect(heartZ2).toHaveTextContent('25%')
    const heartZ3 = screen.getByText('Z3 有氧区').closest('.zone-row')
    expect(heartZ3).toHaveTextContent('00:00:00')
    expect(heartZ3).toHaveTextContent('0%')
    const heartZ4 = screen.getByText('Z4 阈值区').closest('.zone-row')
    expect(heartZ4).toHaveTextContent('00:00:20')
    expect(heartZ4).toHaveTextContent('50%')

    // 功率：Z5 冲刺 10 秒 25%
    const powerZ5 = screen.getByText('Z5 冲刺').closest('.zone-row')
    expect(powerZ5).toHaveTextContent('00:00:10')
    expect(powerZ5).toHaveTextContent('25%')

    expect(screen.queryByText('在设置中配置 FTP 与最大心率后可查看区间分析')).not.toBeInTheDocument()
  })

  it('配置 FTP/最大心率后显示 IF/TSS（恒 200W → IF 1.00、TSS 1）', async () => {
    // 恒 200W、40 秒：NP=200 → IF=200/200=1.00；TSS=40×1²×100/3600≈1.11→1
    await repo.addActivity(makeActivity('act-1', [200, 200, 200, 200, 200], [120, 140, 160, 150, 130]))
    await saveSettings({ profile: { ftp: 200, maxHeartRate: 190 } })
    renderPage()

    expect(await screen.findByText('强度因子（IF）1.00')).toBeInTheDocument()
    expect(screen.getByText('训练压力分数（TSS）1')).toBeInTheDocument()
  })

  it('先渲染无配置（引导文案）→ 保存设置后重挂载显示区间', async () => {
    await repo.addActivity(makeActivity('act-1', [200, 200, 200, 200, 200], [120, 140, 160, 150, 130]))

    const first = renderPage()
    expect(
      await screen.findByText('在设置中配置 FTP 与最大心率后可查看区间分析'),
    ).toBeInTheDocument()

    // 保存 FTP 与最大心率后重新挂载（设置只在挂载时读取）
    await saveSettings({ profile: { ftp: 200, maxHeartRate: 190 } })
    first.unmount()
    renderPage()

    expect(await screen.findByText('心率区间')).toBeInTheDocument()
    expect(screen.getByText('功率区间')).toBeInTheDocument()
    expect(screen.queryByText('在设置中配置 FTP 与最大心率后可查看区间分析')).not.toBeInTheDocument()
  })

  it('配置存在但数据无对应指标时显示引导文案（不伪造区间）', async () => {
    // 仅心率数据（无功率），配置了 FTP 但未配最大心率：无可显示内容 → 引导文案
    await repo.addActivity(
      makeActivity('act-1', [undefined, undefined, undefined, undefined, undefined], [120, 140, 160, 150, 130]),
    )
    await saveSettings({ profile: { ftp: 200 } })
    renderPage()

    expect(
      await screen.findByText('在设置中配置 FTP 与最大心率后可查看区间分析'),
    ).toBeInTheDocument()
    expect(screen.queryByText('功率区间')).not.toBeInTheDocument()
    expect(screen.queryByText('心率区间')).not.toBeInTheDocument()
  })

  it('区间行分布条宽度按百分比渲染', async () => {
    // maxHR=200：hr=[90,120,150,180,100] → Z1 10s（25%）、Z2 10s、Z3 10s、Z5 10s
    await repo.addActivity(makeActivity('act-1', [100, 110, 150, 210, 100], [90, 120, 150, 180, 100]))
    await saveSettings({ profile: { ftp: 200, maxHeartRate: 200 } })
    renderPage()

    const zonesSection = await screen.findByRole('region', { name: '训练区间' })
    const heartZ1 = within(zonesSection).getByText('Z1 恢复区').closest('.zone-row')
    expect(heartZ1).toHaveTextContent('00:00:10')
    expect(heartZ1).toHaveTextContent('25%')
    // 分布条宽度（内层 fill，25%）
    expect(heartZ1!.querySelector('.zone-row__bar-fill')).toHaveStyle({ width: '25%' })
  })
})

describe('活动重命名（规格 §31）', () => {
  let repo: DexieActivityRepository
  const user = userEvent.setup()

  beforeEach(() => {
    repo = new DexieActivityRepository(testDb)
  })

  it('重命名保存后标题与数据库同步更新', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200], [120, 140], { name: '晨骑' }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: '重命名' }))
    const input = screen.getByRole('textbox', { name: '活动名称' })
    await user.clear(input)
    await user.type(input, '周末拉练')
    await user.click(screen.getByRole('button', { name: '保存' }))

    // 标题立即更新，数据库同步落库
    expect(await screen.findByRole('heading', { name: /周末拉练/ })).toBeInTheDocument()
    expect((await repo.getById('act-1'))?.name).toBe('周末拉练')
  })

  it('空名保存恢复「日期 骑行」兜底名', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200], [120, 140], { name: '晨骑' }))
    renderPage()

    await user.click(await screen.findByRole('button', { name: '重命名' }))
    await user.clear(screen.getByRole('textbox', { name: '活动名称' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('heading', { name: /2026-08-01 骑行/ })).toBeInTheDocument()
    expect((await repo.getById('act-1'))?.name).toBe('')
  })

  it('Enter 快捷保存，Escape 取消不改名', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200], [120, 140], { name: '晨骑' }))
    renderPage()

    // Enter 保存
    await user.click(await screen.findByRole('button', { name: '重命名' }))
    const input = screen.getByRole('textbox', { name: '活动名称' })
    await user.clear(input)
    await user.type(input, '夜骑{Enter}')
    expect(await screen.findByRole('heading', { name: /夜骑/ })).toBeInTheDocument()

    // Escape 取消：输入新名后不保存，标题保持夜骑
    await user.click(screen.getByRole('button', { name: '重命名' }))
    const input2 = screen.getByRole('textbox', { name: '活动名称' })
    await user.clear(input2)
    await user.type(input2, '不该出现{Escape}')
    expect(screen.getByRole('heading', { name: /夜骑/ })).toBeInTheDocument()
    expect((await repo.getById('act-1'))?.name).toBe('夜骑')
  })
})

describe('单位偏好显示（规格 §27）', () => {
  let repo: DexieActivityRepository

  beforeEach(() => {
    repo = new DexieActivityRepository(testDb)
    // jsdom 中 getBoundingClientRect 恒为 0，mock 容器尺寸让 Recharts 正常渲染
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 220,
    } as DOMRect)
  })

  it('英里单位设置后距离/速度按 mi 显示', async () => {
    // 本地时区 2026-08-01 15:30 构造，距离 16093.44 m = 10.00 mi，平均速度 10 m/s = 22.4 mph
    await repo.addActivity(
      makeActivity('act-1', [100, 200], [120, 140], {
        startTime: new Date(2026, 7, 1, 15, 30).toISOString(),
        distance: 16093.44,
      }),
    )
    await saveSettings({ units: { distance: 'mi' } })
    renderPage()

    expect(await screen.findByText('10.00 mi')).toBeInTheDocument()
    expect(screen.getByText('22.4 mph')).toBeInTheDocument()
  })

  it('12 小时制设置后开始时间按 12h 显示', async () => {
    // 本地时区 15:30 → '3:30 PM'（Date 本地方法构造，时区无关）
    await repo.addActivity(
      makeActivity('act-1', [100, 200], [120, 140], {
        startTime: new Date(2026, 7, 1, 15, 30).toISOString(),
      }),
    )
    await saveSettings({ units: { timeFormat: '12h' } })
    renderPage()

    expect(await screen.findByText(/3:30 PM/)).toBeInTheDocument()
  })

  it('默认 24 小时制显示', async () => {
    await repo.addActivity(
      makeActivity('act-1', [100, 200], [120, 140], {
        startTime: new Date(2026, 7, 1, 15, 30).toISOString(),
      }),
    )
    renderPage()

    expect(await screen.findByText(/15:30/)).toBeInTheDocument()
  })
})

describe('导出 GPX（后续工作项）', () => {
  let repo: DexieActivityRepository

  beforeEach(() => {
    repo = new DexieActivityRepository(testDb)
  })

  it('含坐标活动：点击导出 GPX 触发下载', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200], [120, 140]))
    // jsdom 未实现 createObjectURL/revokeObjectURL：注入桩；拦截 a.click 防导航
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:mock'),
      configurable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    renderPage()

    const button = await screen.findByRole('button', { name: '导出 GPX' })
    expect(button).toBeEnabled()
    await userEvent.click(button)

    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('无坐标活动：导出按钮禁用', async () => {
    await repo.addActivity(
      makeActivity('act-1', [100], [120], { records: [{ timestamp: 0, power: 100 }] }),
    )
    renderPage()

    expect(await screen.findByRole('button', { name: '导出 GPX' })).toBeDisabled()
  })
})

describe('设为赛段（后续工作项：完整 Segment）', () => {
  let repo: DexieActivityRepository

  beforeEach(async () => {
    repo = new DexieActivityRepository(testDb)
    // 赛段表独立清理：创建断言依赖表计数
    await testDb.segments.clear()
  })

  it('含坐标活动：点击设为赛段落库并跳转', async () => {
    await repo.addActivity(makeActivity('act-1', [100, 200], [120, 140]))
    renderPage()

    const button = await screen.findByRole('button', { name: '设为赛段' })
    expect(button).toBeEnabled()
    await userEvent.click(button)

    // 落库一条赛段：起终点取首尾坐标点（makeActivity 首点 31.2/121.5）
    const segments = await testDb.segments.toArray()
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      startLatitude: 31.2,
      startLongitude: 121.5,
      sourceActivityId: 'act-1',
    })
  })

  it('无坐标活动：设为赛段按钮禁用', async () => {
    await repo.addActivity(
      makeActivity('act-1', [100], [120], { records: [{ timestamp: 0, power: 100 }] }),
    )
    renderPage()

    expect(await screen.findByRole('button', { name: '设为赛段' })).toBeDisabled()
  })
})
