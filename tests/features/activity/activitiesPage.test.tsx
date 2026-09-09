/**
 * 骑行记录列表页集成测试（规格 §14；2026-09 工具栏改版）。
 * 使用 fake-indexeddb + 真仓库：造 25 条跨月/跨年数据，
 * 验证排序切换、搜索、年份/月份筛选、自定义筛选弹窗（预设多选/新建/修改/删除）、
 * 分页（每页大小可选）与行点击跳转。
 * 日期断言固定 UTC 时区（beforeAll 设置、afterAll 恢复，避免污染共享进程影响其他测试文件）。
 */
import 'fake-indexeddb/auto'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ActivitiesPage from '@/pages/ActivitiesPage'
import { CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { DEFAULT_PAGE_SIZE, useActivityFilterStore } from '@/stores/activityFilterStore'
import { formatDate, formatDistance } from '@/utils/format'
import type { Activity } from '@/types/activity'

/**
 * 生成 25 条测试活动：
 * - act-01..16 为 2026-08，act-17..22 为 2026-07，act-23..25 为 2026-06
 * - act-01..22 类型 cycling，act-23..25 类型 running
 * - startTime 越早编号越大（act-01 最新，默认降序第一行）
 * - 距离/时长/爬升/速度随编号递增
 * - 心率在编号为 3 的倍数时缺失，功率在编号为 5 的倍数时缺失
 */
function makeSeed(): Activity[] {
  return Array.from({ length: 25 }, (_, i) => {
    const n = i + 1
    const month = n <= 16 ? '2026-08' : n <= 22 ? '2026-07' : '2026-06'
    const day = String(30 - n).padStart(2, '0')
    return {
      id: `act-${String(n).padStart(2, '0')}`,
      fileId: `file-${n}`,
      fileName: `ride-${String(n).padStart(2, '0')}.fit`,
      fingerprint: `fp-${String(n).padStart(2, '0')}`,
      activityType: n <= 22 ? 'cycling' : 'running',
      startTime: `${month}-${day}T10:00:00.000Z`,
      endTime: `${month}-${day}T12:00:00.000Z`,
      duration: 1800 + n * 60,
      elapsedTime: 1800 + n * 60,
      distance: 10000 + n * 1000,
      elevationGain: 100 + n * 10,
      avgSpeed: 6 + n / 100,
      avgHeartRate: n % 3 === 0 ? undefined : 140 + n,
      avgPower: n % 5 === 0 ? undefined : 200 + n,
    }
  })
}

/** 详情页占位路由（验证行点击跳转，真实详情页由 Phase 6 提供） */
function DetailStub() {
  const { id } = useParams()
  return <div>详情页 {id}</div>
}

const ORIGINAL_TZ = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'UTC'
})

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

describe('骑行记录列表页', () => {
  let db: CyclingDatabase
  let repo: DexieActivityRepository
  const user = userEvent.setup()

  beforeEach(() => {
    db = new CyclingDatabase()
    repo = new DexieActivityRepository(db)
    // 筛选/排序为持久化 store（模块级单例），测试间重置避免串扰
    // （resetFilters 不清预设：预设跨刷新保留是产品行为，测试里需手动清空内存态）
    useActivityFilterStore.setState({ presets: {} })
    useActivityFilterStore.getState().resetFilters()
    useActivityFilterStore.getState().resetSort()
    useActivityFilterStore.getState().setPageSize(DEFAULT_PAGE_SIZE)
    localStorage.clear()
  })

  afterEach(async () => {
    await db.delete()
  })

  /** 渲染页面（MemoryRouter + 详情页占位路由；写仓库注入同一实例供批量重命名用） */
  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/activities']}>
        <Routes>
          <Route path="/activities" element={<ActivitiesPage repository={repo} writeRepository={repo} />} />
          <Route path="/activities/:id" element={<DetailStub />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  /** 等待首条数据行文本包含指定标题（用于排序/筛选断言） */
  async function expectFirstRowText(text: string) {
    await waitFor(() => {
      const rows = screen.getAllByRole('row')
      expect(rows[1]).toHaveTextContent(text)
    })
  }

  it('默认按开始时间降序显示第一页（20 条），标题缺省时显示默认标题', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // 第一行为最新的 act-01（8 月 29 日）
    const firstRow = screen.getAllByRole('row')[1]
    const act01 = makeSeed()[0]
    expect(firstRow).toHaveTextContent(`${formatDate(act01.startTime)} 骑行`)
    expect(firstRow).toHaveTextContent(formatDate(act01.startTime))
    expect(firstRow).toHaveTextContent(formatDistance(act01.distance))
    expect(firstRow).toHaveTextContent('141 bpm')
    expect(firstRow).toHaveTextContent('201 W')
  })

  it('心率/功率缺失时显示占位符', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // act-03 心率缺失（编号 3 的倍数），功率存在
    const row3 = screen.getAllByRole('row')[3]
    expect(row3).toHaveTextContent('—')
    expect(row3).toHaveTextContent('203 W')
  })

  it('点击表头切换距离排序：降序 → 升序', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    // 初始按时间降序，第一行为 act-01（最新）
    await expectFirstRowText(`${formatDate('2026-08-29T10:00:00.000Z')} 骑行`)

    // 点击"距离"→ 距离降序，第一行为距离最大的 act-25
    await user.click(screen.getByRole('button', { name: /^距离/ }))
    await expectFirstRowText(`${formatDate('2026-06-05T10:00:00.000Z')} 骑行`)

    // 再次点击 → 距离升序，第一行为距离最小的 act-01
    await user.click(screen.getByRole('button', { name: /^距离/ }))
    await expectFirstRowText(`${formatDate('2026-08-29T10:00:00.000Z')} 骑行`)
  })

  it('点击时长表头按时长降序排列', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    // 等待表格渲染完成后再交互
    await expectFirstRowText(`${formatDate('2026-08-29T10:00:00.000Z')} 骑行`)

    await user.click(screen.getByRole('button', { name: /^时长/ }))
    // act-25 时长最长（3300 秒）
    await expectFirstRowText(`${formatDate('2026-06-05T10:00:00.000Z')} 骑行`)
  })

  it('搜索按文件名模糊过滤（不区分大小写）', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    const searchBox = screen.getByLabelText('搜索')
    await user.type(searchBox, 'ride-02')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-08-28T10:00:00.000Z')} 骑行`,
    )

    // 大小写不敏感
    await user.clear(searchBox)
    await user.type(searchBox, 'RIDE-05')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-08-25T10:00:00.000Z')} 骑行`,
    )
  })

  it('月份筛选：选择 2026-07 只显示 7 月记录', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    // 等待月份选项从全量数据生成完成
    await waitFor(() => expect(screen.getByRole('option', { name: '2026-07' })).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('月份'), '2026-07')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(7))

    // 7 月最新记录为 act-17（7 月 13 日）
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-07-13T10:00:00.000Z')} 骑行`,
    )
  })

  it('年份筛选：仅显示所选年份记录，月份选项随年份过滤', async () => {
    // 额外造两条 2025 年记录
    await repo.addActivities([
      ...makeSeed(),
      {
        id: 'old-1',
        fileId: 'file-o1',
        fileName: 'old-1.fit',
        fingerprint: 'fp-o1',
        activityType: 'cycling',
        startTime: '2025-05-10T10:00:00.000Z',
        endTime: '2025-05-10T12:00:00.000Z',
        duration: 3600,
        elapsedTime: 3600,
        distance: 20000,
        avgSpeed: 6,
      },
      {
        id: 'old-2',
        fileId: 'file-o2',
        fileName: 'old-2.fit',
        fingerprint: 'fp-o2',
        activityType: 'cycling',
        startTime: '2025-06-11T10:00:00.000Z',
        endTime: '2025-06-11T12:00:00.000Z',
        duration: 3600,
        elapsedTime: 3600,
        distance: 25000,
        avgSpeed: 6,
      },
    ])
    renderPage()

    // 等待年份选项从全量数据生成完成
    await waitFor(() => expect(screen.getByRole('option', { name: '2025 年' })).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('年份'), '2025')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))

    // 月份选项仅剩 2025 年的月份（降序：最新在前）
    const monthSelect = screen.getByLabelText('月份') as HTMLSelectElement
    const monthValues = [...monthSelect.options].map((option) => option.value).filter((v) => v !== '')
    expect(monthValues).toEqual(['2025-06', '2025-05'])

    // 切回全部年份恢复全量（第 1 页 20 条）
    await user.selectOptions(screen.getByLabelText('年份'), '')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
  })

  it('分页：25 条数据分为 2 页，页码可点且可前后翻页', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    // 第 1 页：表头 + 20 条，显示总条数
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
    expect(screen.getByText('共 25 条')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()

    // 下一页 → 第 2 页：表头 + 5 条
    await user.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6))
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()

    // 点页码回第 1 页
    await user.click(screen.getByRole('button', { name: '第 1 页' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
  })

  it('每页条数可选（最大 500），切换后回到第一页', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    // 默认 20 条/页
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // 10条/页 → 第 1 页 10 条
    await user.selectOptions(screen.getByLabelText('每页条数'), '10')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11))

    // 500条/页 → 全部 25 条单页展示
    await user.selectOptions(screen.getByLabelText('每页条数'), '500')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(26))
    expect(screen.getByText('共 25 条')).toBeInTheDocument()
  })

  it('无数据时显示引导文案', async () => {
    renderPage()
    expect(await screen.findByText('还没有骑行记录，点击左侧同步骑行数据')).toBeInTheDocument()
  })

  it('筛选无结果时显示空结果文案', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    const searchBox = screen.getByLabelText('搜索')
    await user.type(searchBox, '不存在的关键词')
    expect(await screen.findByText('没有符合筛选条件的记录')).toBeInTheDocument()
  })

  it('点击行跳转详情页', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
    await user.click(screen.getAllByRole('row')[1])
    expect(await screen.findByText('详情页 act-01')).toBeInTheDocument()
  })

  it('自定义筛选弹窗：新建预设并应用，条件以 chips 生效', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // 打开弹窗：空预设提示
    await user.click(screen.getByRole('button', { name: '自定义筛选' }))
    expect(await screen.findByRole('dialog', { name: '过滤条件' })).toBeInTheDocument()
    expect(screen.getByText('还没有筛选预设，点击「新建」创建')).toBeInTheDocument()

    // 新建：名称 + 条件行（距离 大于 20）
    await user.click(screen.getByRole('button', { name: '新建' }))
    await user.type(screen.getByLabelText(/名称/), '中长途')
    await user.selectOptions(screen.getByLabelText('条件列 1'), 'distance')
    await user.type(screen.getByLabelText('值 1'), '20')
    await user.click(screen.getByRole('button', { name: '保存' }))

    // 回列表视图：预设行出现，说明列展示条件文案
    expect(screen.getByText('中长途')).toBeInTheDocument()
    expect(screen.getByText('距离 大于 20 km')).toBeInTheDocument()

    // 勾选并应用 → 弹窗关闭，列表过滤（距离 ≥ 20km → act-10..25 共 16 条）且 chip 出现
    await user.click(screen.getByRole('checkbox', { name: '选择 中长途' }))
    await user.click(screen.getByRole('button', { name: /^应用/ }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '过滤条件' })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(17))
    expect(screen.getByText('距离 大于 20 km')).toBeInTheDocument()

    // 点击 chip × 移除条件，恢复全量
    await user.click(screen.getByRole('button', { name: '移除条件 距离 大于 20 km' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
  })

  it('自定义筛选弹窗：多选预设应用为条件并集（AND），介于条件闭区间生效', async () => {
    await repo.addActivities(makeSeed())
    // 预置两个预设：距离 介于 15 ~ 20 km；时长 大于 40 分钟（duration=1800+n*60 ≥ 2400 → n ≥ 10）
    useActivityFilterStore.getState().savePreset('中长途', [
      { field: 'distance', op: 'between', value: '15', value2: '20' },
    ])
    useActivityFilterStore.getState().savePreset('有强度', [
      { field: 'duration', op: 'gt', value: '40' },
    ])
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    await user.click(screen.getByRole('button', { name: '自定义筛选' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 中长途' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 有强度' }))
    await user.click(screen.getByRole('button', { name: /^应用/ }))

    // 距离 15~20km（act-05..10）且时长 ≥ 40min（act-10..25）→ 交集 act-10 共 1 条
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-08-20T10:00:00.000Z')} 骑行`,
    )
    // 两个预设的条件 chips 均展示
    expect(screen.getByText('距离 15 ~ 20 km')).toBeInTheDocument()
    expect(screen.getByText('时长 大于 40 分钟')).toBeInTheDocument()
  })

  it('自定义筛选弹窗：修改预设条件并改名保存', async () => {
    await repo.addActivities(makeSeed())
    useActivityFilterStore.getState().savePreset('中长途', [
      { field: 'distance', op: 'gt', value: '20' },
    ])
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    await user.click(screen.getByRole('button', { name: '自定义筛选' }))
    expect(await screen.findByRole('dialog', { name: '过滤条件' })).toBeInTheDocument()

    // 修改：名称回显、条件回显；改阈值并改名
    await user.click(screen.getByRole('button', { name: '修改' }))
    expect(screen.getByLabelText(/名称/)).toHaveValue('中长途')
    expect(screen.getByLabelText('值 1')).toHaveValue(20)
    await user.clear(screen.getByLabelText('值 1'))
    await user.type(screen.getByLabelText('值 1'), '30')
    await user.clear(screen.getByLabelText(/名称/))
    await user.type(screen.getByLabelText(/名称/), '长途')
    await user.click(screen.getByRole('button', { name: '保存' }))

    // 列表视图：旧名消失，新名 + 新条件文案
    expect(screen.getByText('长途')).toBeInTheDocument()
    expect(screen.getByText('距离 大于 30 km')).toBeInTheDocument()
    expect(screen.queryByText('中长途')).not.toBeInTheDocument()
  })

  it('自定义筛选弹窗：行内删除与勾选批量删除预设', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await repo.addActivities(makeSeed())
    useActivityFilterStore.getState().savePreset('甲', [{ field: 'distance', op: 'gt', value: '20' }])
    useActivityFilterStore.getState().savePreset('乙', [{ field: 'duration', op: 'gt', value: '40' }])
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    await user.click(screen.getByRole('button', { name: '自定义筛选' }))
    expect(await screen.findByRole('dialog', { name: '过滤条件' })).toBeInTheDocument()

    // 行内删除「甲」（表格行内删除按钮在前，底部批量删除按钮在后）
    await user.click(screen.getAllByRole('button', { name: '删除' })[0])
    await waitFor(() => expect(screen.queryByText('甲')).not.toBeInTheDocument())
    expect(screen.getByText('乙')).toBeInTheDocument()

    // 勾选「乙」→ 底部删除（文档序最后一个「删除」按钮）→ confirm 确认后删除
    await user.click(screen.getByRole('checkbox', { name: '选择 乙' }))
    const deleteButtons = screen.getAllByRole('button', { name: '删除' })
    await user.click(deleteButtons[deleteButtons.length - 1])
    expect(screen.getByText('还没有筛选预设，点击「新建」创建')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('筛选条件持久化：卸载重渲染后仍保留，不自动清理', async () => {
    await repo.addActivities(makeSeed())
    const { unmount } = renderPage()

    const searchBox = screen.getByLabelText('搜索')
    await user.type(searchBox, 'ride-02')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))

    // 卸载再挂载：筛选条件来自持久化 store，仍生效
    unmount()
    renderPage()
    expect(screen.getByLabelText('搜索')).toHaveValue('ride-02')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
  })

  it('重置按钮：清空全部筛选条件，仅手动触发', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getByRole('option', { name: '2026-07' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('月份'), '2026-07')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(7))

    const searchBox = screen.getByLabelText('搜索')
    await user.type(searchBox, 'ride-17')
    // 7 月 + 关键词 ride-17 → 仅 act-17
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))

    // 重置 → 月份与搜索全部清空，恢复全量（第 1 页 20 条）
    await user.click(screen.getByRole('button', { name: '重置' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
    expect(screen.getByLabelText('月份')).toHaveValue('')
    expect(screen.getByLabelText('搜索')).toHaveValue('')
  })

  it('轨迹纠偏入口：作用于筛选命中的全部记录，打开批量纠偏弹窗', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // 筛选 7 月（6 条）后点击轨迹纠偏 → 弹窗打开
    await waitFor(() => expect(screen.getByRole('option', { name: '2026-07' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('月份'), '2026-07')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(7))

    await user.click(screen.getByRole('button', { name: '轨迹纠偏' }))
    expect(await screen.findByRole('dialog', { name: '批量轨迹纠偏' })).toBeInTheDocument()
  })

  it('批量重命名：按模板预览并应用，全部命中记录写入新名称', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // 打开弹窗：候选为筛选命中的全部记录（25 条，非仅当前页 20 条）
    await user.click(screen.getByRole('button', { name: '批量重命名' }))
    expect(await screen.findByRole('dialog', { name: '批量重命名' })).toBeInTheDocument()
    expect(screen.getByText('批量重命名（25 条）')).toBeInTheDocument()

    // 默认模板预览：act-01（距离 11000m）→ '2026-08-29 cycling 11km'
    expect(screen.getByText('2026-08-29 cycling 11km')).toBeInTheDocument()

    // 改为序号模板后应用（模板含 {} 占位符，userEvent 会误解析为按键，改用 fireEvent）
    const templateInput = screen.getByLabelText('命名模板')
    await user.clear(templateInput)
    fireEvent.change(templateInput, { target: { value: '晨骑{序号}' } })
    expect(screen.getByText('晨骑01')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '应用到全部' }))

    // 应用成功后弹窗关闭、列表刷新，且数据已写入本地库
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '批量重命名' })).not.toBeInTheDocument(),
    )
    await waitFor(async () => {
      const first = await repo.getById('act-01')
      expect(first?.name).toBe('晨骑01')
    })
    const last = await repo.getById('act-25')
    expect(last?.name).toBe('晨骑25')
  })

  it('批量重命名：模板为空白时禁止应用', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
    await user.click(screen.getByRole('button', { name: '批量重命名' }))
    expect(await screen.findByRole('dialog', { name: '批量重命名' })).toBeInTheDocument()

    const templateInput = screen.getByLabelText('命名模板')
    await user.clear(templateInput)
    expect(screen.getByRole('button', { name: '应用到全部' })).toBeDisabled()
  })

  it('全部 8 列可排序：爬升/平均速度/平均心率/平均功率降序', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await expectFirstRowText(`${formatDate('2026-08-29T10:00:00.000Z')} 骑行`)

    // 爬升降序 → act-25 爬升最大（350m）
    await user.click(screen.getByRole('button', { name: /^爬升/ }))
    await expectFirstRowText(`${formatDate('2026-06-05T10:00:00.000Z')} 骑行`)

    // 平均速度降序 → act-25 最大（6.25 m/s）
    await user.click(screen.getByRole('button', { name: /^平均速度/ }))
    await expectFirstRowText(`${formatDate('2026-06-05T10:00:00.000Z')} 骑行`)

    // 平均心率降序 → act-25 最大（165 bpm，非 3 的倍数不缺失）
    await user.click(screen.getByRole('button', { name: /^平均心率/ }))
    await expectFirstRowText(`${formatDate('2026-06-05T10:00:00.000Z')} 骑行`)

    // 平均功率降序 → act-25 功率缺失（5 的倍数），act-24 最大（224W）
    await user.click(screen.getByRole('button', { name: /^平均功率/ }))
    await expectFirstRowText(`${formatDate('2026-06-06T10:00:00.000Z')} 骑行`)
  })

  it('标题列可按名称排序', async () => {
    // name 仅经 addActivity(activity, name) 落库（addActivities 不带 name），逐条插入
    // act-01 → 骑行 25 ... act-25 → 骑行 01（与 startTime 降序一致的反向命名）
    const named = makeSeed()
    for (let index = 0; index < named.length; index += 1) {
      await repo.addActivity(named[index], `骑行 ${String(25 - index).padStart(2, '0')}`)
    }
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // 标题首次点击为降序 → 「骑行 25」（act-01）在第一行
    await user.click(screen.getByRole('button', { name: /^标题/ }))
    await expectFirstRowText('骑行 25')

    // 再点切升序 → 「骑行 01」（act-25）在第一行
    await user.click(screen.getByRole('button', { name: /^标题/ }))
    await expectFirstRowText('骑行 01')
  })

  it('排序持久化不自动重置：切筛选/重渲染后保持，仅手动重置排序还原', async () => {
    await repo.addActivities(makeSeed())
    const { unmount } = renderPage()

    await expectFirstRowText(`${formatDate('2026-08-29T10:00:00.000Z')} 骑行`)

    // 距离降序
    await user.click(screen.getByRole('button', { name: /^距离/ }))
    await expectFirstRowText(`${formatDate('2026-06-05T10:00:00.000Z')} 骑行`)

    // 修改筛选（月份）：排序保持距离降序，不重置
    await waitFor(() => expect(screen.getByRole('option', { name: '2026-07' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('月份'), '2026-07')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(7))
    // 7 月距离最大为 act-22（32km，7 月 8 日）
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-07-08T10:00:00.000Z')} 骑行`,
    )

    // 卸载重渲染：排序来自持久化 store，仍为距离降序
    await user.selectOptions(screen.getByLabelText('月份'), '')
    unmount()
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-06-05T10:00:00.000Z')} 骑行`,
    )

    // 手动重置排序 → 回到默认开始时间降序（act-01 最新）
    await user.click(screen.getByRole('button', { name: '重置排序' }))
    await expectFirstRowText(`${formatDate('2026-08-29T10:00:00.000Z')} 骑行`)
  })

  it('勾选批量删除：默认阈值无警告，调低阈值后疑似脏数据黄色警告', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // 勾选前两行（act-01/act-02，距离均 > 5km）
    await user.click(screen.getByRole('checkbox', { name: '选择 ride-01.fit' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 ride-02.fit' }))
    expect(screen.getByText('已勾选 2 条')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除选中' }))
    expect(await screen.findByRole('dialog', { name: '确认删除' })).toBeInTheDocument()
    expect(screen.getByText('即将删除 2 条骑行记录：')).toBeInTheDocument()

    // 默认阈值 5km/10min：两条均不疑似脏数据（11km/12km，40min/41min）
    expect(screen.queryByText(/疑似脏数据/)).not.toBeInTheDocument()

    // 距离阈值调到 12 → act-01（11km）触发警告，act-02（12km）不触发（含边界不比较相等）
    await user.clear(screen.getByLabelText('脏数据距离阈值'))
    await user.type(screen.getByLabelText('脏数据距离阈值'), '12')
    expect(screen.getByText(/以下 1 条记录低于阈值，疑似脏数据/)).toBeInTheDocument()
    expect(screen.getByText(/距离 11\.0 km < 12 km/)).toBeInTheDocument()

    // 取消关闭
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '确认删除' })).not.toBeInTheDocument()
    // 勾选保留
    expect(screen.getByText('已勾选 2 条')).toBeInTheDocument()
  })

  it('勾选批量删除：确认后从本地库删除并清空勾选刷新列表', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    await user.click(screen.getByRole('checkbox', { name: '选择 ride-01.fit' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 ride-02.fit' }))
    await user.click(screen.getByRole('button', { name: '删除选中' }))
    expect(await screen.findByRole('dialog', { name: '确认删除' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认删除' }))

    // 弹窗关闭、勾选清空、列表刷新为 23 条（25 - 2，第 1 页 20 行）
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '确认删除' })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
    expect(screen.queryByText('已勾选 2 条')).not.toBeInTheDocument()
    expect(await repo.getById('act-01')).toBeUndefined()
    expect(await repo.getById('act-02')).toBeUndefined()
    expect(await repo.getById('act-03')).not.toBeUndefined()
  })

  it('勾选批量删除：勾选框点击不触发行跳转，全选覆盖当前页', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))

    // 全选本页 20 条 → 已勾选 20 条
    await user.click(screen.getByRole('checkbox', { name: '全选本页' }))
    expect(screen.getByText('已勾选 20 条')).toBeInTheDocument()

    // 再次点击取消全选
    await user.click(screen.getByRole('checkbox', { name: '全选本页' }))
    expect(screen.queryByText('已勾选 20 条')).not.toBeInTheDocument()

    // 勾选单个不触发导航（仍停留在列表页）
    await user.click(screen.getByRole('checkbox', { name: '选择 ride-01.fit' }))
    expect(screen.getByText('骑行记录')).toBeInTheDocument()
    expect(screen.queryByText('详情页 act-01')).not.toBeInTheDocument()
  })
})
