/**
 * 活动详情页「本次赛段」区块测试。
 *
 * fake-indexeddb + 真 Dexie 实例注入：验证实时匹配、vs 最好差值、
 * 新纪录/首条成绩徽章与本地源成绩回写。
 */
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import ActivityMatchedSegments from '@/features/segments/ActivityMatchedSegments'
import type { ActivityRecord } from '@/types/activity'

/** 每用例独立数据库实例（库名隔离） */
let testDb: CyclingDatabase
let repository: DexieSegmentRepository

beforeEach(async () => {
  testDb = new CyclingDatabase(`matched-segments-test-${crypto.randomUUID()}`)
  repository = new DexieSegmentRepository(testDb)
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
})
