/**
 * 活动详情页「本次赛段」区块测试。
 *
 * fake-indexeddb + 真 Dexie 实例注入：验证实时匹配、vs 最好差值、
 * 新纪录/首条成绩徽章与本地源成绩回写。
 */
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { CyclingDatabase, db as globalDb } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import ActivityMatchedSegments from '@/features/segments/ActivityMatchedSegments'
import type { ActivityRecord } from '@/types/activity'

/** 每用例独立数据库实例（库名隔离） */
let testDb: CyclingDatabase
let repository: DexieSegmentRepository

beforeEach(async () => {
  testDb = new CyclingDatabase(`matched-segments-test-${crypto.randomUUID()}`)
  repository = new DexieSegmentRepository(testDb)
  // 对比展开经 useActivityRepository 读全局库：本地源 + 预置最好成绩活动
  useDataSourceStore.setState({ source: 'local', authorAvailable: false, authorName: null })
  await globalDb.activities.clear()
  await globalDb.activity_blobs.clear()
})

/** 穿越测试赛段的轨迹：t=startTs 进起点圈，t=endTs 进终点圈 → endTs - startTs 秒 */
function makeThroughRecords(startTs = 100, endTs = 700): ActivityRecord[] {
  return [
    { timestamp: 0, latitude: 31.19, longitude: 121.49 },
    { timestamp: startTs, latitude: 31.2001, longitude: 121.5001 },
    { timestamp: endTs, latitude: 31.3001, longitude: 121.6001 },
  ]
}

/** 渲染组件（本地源，注入测试仓库） */
function renderSection(activityId = 'act-new', records: ActivityRecord[] = makeThroughRecords()) {
  return render(
    <MemoryRouter>
      <ActivityMatchedSegments
        activityId={activityId}
        startTime="2026-09-12T08:00:00"
        records={records}
        source="local"
        repository={repository}
      />
    </MemoryRouter>,
  )
}

/** 写入测试赛段（起终点圆与 makeThroughRecords 匹配） */
async function seedSegment(name = '滨江爬坡'): Promise<number> {
  return repository.addSegment({
    name,
    startLatitude: 31.2,
    startLongitude: 121.5,
    endLatitude: 31.3,
    endLongitude: 121.6,
    sourceActivityId: 'act-old',
    createdAt: '2026-08-01T08:00:00',
  })
}

describe('ActivityMatchedSegments', () => {
  it('未穿越任何赛段时整块不渲染', async () => {
    await seedSegment()
    render(
      <MemoryRouter>
        <ActivityMatchedSegments
          activityId="act-new"
          startTime="2026-09-12T08:00:00"
          records={[{ timestamp: 0, latitude: 0, longitude: 0 }]}
          source="local"
          repository={repository}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByText('本次赛段')).not.toBeInTheDocument()
  })

  it('匹配经过的赛段并展示首条成绩徽章', async () => {
    const segmentId = await seedSegment()
    renderSection()

    expect(await screen.findByText('本次赛段')).toBeInTheDocument()
    expect(screen.getByText('滨江爬坡')).toBeInTheDocument()
    expect(screen.getByText('首条成绩')).toBeInTheDocument()
    // 用时 = 700 - 100 = 600s
    expect(screen.getByText('00:10:00')).toBeInTheDocument()
    // 名称链接到赛段详情页
    expect(screen.getByRole('link', { name: /滨江爬坡/ })).toHaveAttribute(
      'href',
      `/segments/${segmentId}`,
    )
  })

  it('快于历史最好时展示新纪录徽章与差值，并回写成绩', async () => {
    const segmentId = await seedSegment()
    // 历史最好：act-old 800s；本次 600s → 新纪录 -200s
    await repository.upsertActivityEffort(segmentId, 'act-old', {
      startTime: '2026-08-01T08:00:00',
      durationSeconds: 800,
    })
    renderSection()

    expect(await screen.findByText('新纪录')).toBeInTheDocument()
    // 差值 200s ≥ 60s，按分秒格式展示
    expect(screen.getByText('-3:20 vs 最好')).toBeInTheDocument()
    // 最好成绩出现在 meta 中
    expect(screen.getByText(/最好 00:13:20/)).toBeInTheDocument()

    // 本地源回写：本次成绩已落库（含 startTime）
    const efforts = await repository.listEffortsBySegment(segmentId)
    expect(efforts.map((e) => e.activityId)).toEqual(['act-new', 'act-old'])
    expect(efforts[0]).toMatchObject({ durationSeconds: 600, startTime: '2026-09-12T08:00:00' })
  })

  it('慢于历史最好时展示慢差值；进入前三给名次徽章', async () => {
    const segmentId = await seedSegment()
    // 已有 2 条更好成绩（600s / 650s），本次 700s → 个人第 3、慢 100s
    await repository.upsertActivityEffort(segmentId, 'act-1', {
      startTime: '2026-08-01T08:00:00',
      durationSeconds: 600,
    })
    await repository.upsertActivityEffort(segmentId, 'act-2', {
      startTime: '2026-08-02T08:00:00',
      durationSeconds: 650,
    })
    renderSection('act-3', makeThroughRecords(100, 800))

    expect(await screen.findByText('个人第 3')).toBeInTheDocument()
    // 差值 100s ≥ 60s，按分秒格式展示
    expect(screen.getByText('+1:40 vs 最好')).toBeInTheDocument()
  })

  it('点击「对比」展开前后半程对比（懒加载最好成绩活动逐点重新匹配）', async () => {
    const segmentId = await seedSegment()
    // 最好成绩 act-old：800s（窗口 100 → 900）
    await repository.upsertActivityEffort(segmentId, 'act-old', {
      startTime: '2026-08-01T08:00:00',
      durationSeconds: 800,
    })
    // 最好成绩活动的逐点数据进全局库（useActivityRepository 本地源读取）
    const activityRepository = new DexieActivityRepository(globalDb)
    await activityRepository.addActivity({
      id: 'act-old',
      fileId: 'file-act-old',
      fileName: 'act-old.fit',
      fingerprint: 'fp-act-old',
      activityType: 'cycling',
      startTime: '2026-08-01T08:00:00',
      endTime: '2026-08-01T09:00:00',
      duration: 3600,
      elapsedTime: 3600,
      distance: 14000,
      records: makeThroughRecords(100, 900),
    })
    renderSection('act-new')

    await screen.findByText('新纪录')
    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    // 本次窗口 100→700（前/后各 300s），最好窗口 100→900（前/后各 400s）
    // 两半程数值相同（各 2 行）
    expect((await screen.findAllByText(/前半程|后半程/)).length).toBe(2)
    expect(screen.getAllByText(/本次 00:05:00 · 最好 00:06:40/).length).toBe(2)
    // 收起
    await userEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.queryByText(/前半程/)).not.toBeInTheDocument()
  })

  it('新纪录行提供分享图按钮（jsdom 无 2d context 不抛错）', async () => {
    const segmentId = await seedSegment()
    await repository.upsertActivityEffort(segmentId, 'act-old', {
      startTime: '2026-08-01T08:00:00',
      durationSeconds: 800,
    })
    renderSection('act-new')

    await screen.findByText('新纪录')
    const shareButton = screen.getByRole('button', { name: '分享图' })
    // 点击不抛错（jsdom canvas.getContext 返回 null，绘制层安全返回 false）
    await userEvent.click(shareButton)
  })
})
