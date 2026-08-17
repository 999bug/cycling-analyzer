/**
 * 骑行记录列表页集成测试（规格 §14）。
 * 使用 fake-indexeddb + 真仓库：造 25 条跨月/跨类型数据，
 * 验证排序切换、搜索、月份/类型/数值筛选、分页、空状态与行点击跳转。
 * 日期断言固定 UTC 时区（beforeAll 设置、afterAll 恢复，避免污染共享进程影响其他测试文件）。
 */
import 'fake-indexeddb/auto'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import ActivitiesPage from '@/pages/ActivitiesPage'
import { CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
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
  })

  afterEach(async () => {
    await db.delete()
  })

  /** 渲染页面（MemoryRouter + 详情页占位路由） */
  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/activities']}>
        <Routes>
          <Route path="/activities" element={<ActivitiesPage repository={repo} />} />
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

  it('类型筛选：选择 running 只显示跑步记录', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    // 等待类型选项从全量数据生成完成
    await waitFor(() => expect(screen.getByRole('option', { name: 'running' })).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('类型'), 'running')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4))

    // 跑步记录为 act-23..25，最新为 act-23（6 月 7 日）
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-06-07T10:00:00.000Z')} 骑行`,
    )
  })

  it('分页：25 条数据分为 2 页，可前后翻页', async () => {
    await repo.addActivities(makeSeed())
    renderPage()

    // 第 1 页：表头 + 20 条
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()

    // 下一页 → 第 2 页：表头 + 5 条
    await user.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6))
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()

    // 上一页 → 回到第 1 页
    await user.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21))
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument()
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

  it('数值筛选：距离/爬升/功率 AND 组合，输入为空不限制', async () => {
    // 三条活动：a 距离/爬升达标但功率不足；b 距离达标但爬升不足；c 爬升/功率达标但距离不足
    await repo.addActivities([
      {
        id: 'a',
        fileId: 'file-a',
        fileName: 'a.fit',
        fingerprint: 'fp-a',
        activityType: 'cycling',
        startTime: '2026-08-03T10:00:00.000Z',
        endTime: '2026-08-03T12:00:00.000Z',
        duration: 7200,
        elapsedTime: 7200,
        distance: 120000,
        elevationGain: 1500,
        avgSpeed: 8,
        avgHeartRate: 150,
        avgPower: 180,
      },
      {
        id: 'b',
        fileId: 'file-b',
        fileName: 'b.fit',
        fingerprint: 'fp-b',
        activityType: 'cycling',
        startTime: '2026-08-02T10:00:00.000Z',
        endTime: '2026-08-02T12:00:00.000Z',
        duration: 7200,
        elapsedTime: 7200,
        distance: 120000,
        elevationGain: 800,
        avgSpeed: 8,
        avgHeartRate: 150,
        avgPower: 250,
      },
      {
        id: 'c',
        fileId: 'file-c',
        fileName: 'c.fit',
        fingerprint: 'fp-c',
        activityType: 'cycling',
        startTime: '2026-08-01T10:00:00.000Z',
        endTime: '2026-08-01T12:00:00.000Z',
        duration: 7200,
        elapsedTime: 7200,
        distance: 90000,
        elevationGain: 1500,
        avgSpeed: 8,
        avgHeartRate: 150,
        avgPower: 250,
      },
    ])
    renderPage()

    // 初始 3 条数据（表头 + 3 行）
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4))

    // 最小距离 100 km → 只剩 a、b（120km 达标，90km 被排除）
    const distanceInput = screen.getByLabelText('距离(km)')
    await user.type(distanceInput, '100')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-08-03T10:00:00.000Z')} 骑行`,
    )

    // 再加最小爬升 1000 m → 只剩 a（b 的 800m 被排除）
    const elevationInput = screen.getByLabelText('爬升(m)')
    await user.type(elevationInput, '1000')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-08-03T10:00:00.000Z')} 骑行`,
    )

    // 再加最小平均功率 200 W → a 的 180W 被排除，无匹配
    const powerInput = screen.getByLabelText('平均功率(W)')
    await user.type(powerInput, '200')
    expect(await screen.findByText('没有符合筛选条件的记录')).toBeInTheDocument()

    // 清空功率 → 距离 ≥100km 且爬升 ≥1000m → 只剩 a
    await user.clear(powerInput)
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-08-03T10:00:00.000Z')} 骑行`,
    )

    // 清空距离 → 爬升 ≥1000m（功率已清空）→ a、c（c 之前被距离条件排除，现在恢复）
    await user.clear(distanceInput)
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      `${formatDate('2026-08-03T10:00:00.000Z')} 骑行`,
    )
    expect(screen.getAllByRole('row')[2]).toHaveTextContent(
      `${formatDate('2026-08-01T10:00:00.000Z')} 骑行`,
    )
  })
})
