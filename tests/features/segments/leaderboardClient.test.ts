/**
 * 赛段成绩榜 worker 客户端测试（GPX 导入卡死修复）。
 *
 * mock 全局 Worker 验证消息协议：请求携带自增 id、响应按 id 关联、
 * onerror 拒绝所有未决请求、cancel 以取消错误拒绝并 terminate。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLeaderboardRunner,
  LEADERBOARD_CANCELLED,
} from '@/features/segments/leaderboardClient'
import type { SegmentGeometry } from '@/features/segments/segmentMatching'

/** 可手动触发回调的假 Worker */
class FakeWorker {
  static last: FakeWorker | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  posted: unknown[] = []
  terminated = false

  constructor() {
    FakeWorker.last = this
  }

  postMessage(data: unknown): void {
    this.posted.push(data)
  }

  terminate(): void {
    this.terminated = true
  }
}

const SEGMENT: SegmentGeometry = {
  startLatitude: 31.2,
  startLongitude: 121.5,
  endLatitude: 31.3,
  endLongitude: 121.6,
}

describe('leaderboardClient', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWorker.last = null
  })

  it('compute 发送带自增 id 的请求，响应按 id 关联解析', async () => {
    const runner = createLeaderboardRunner()
    expect(runner).not.toBeNull()

    const first = runner!.compute({ segment: SEGMENT, inputs: [] })
    const second = runner!.compute({ segment: SEGMENT, inputs: [] })

    const worker = FakeWorker.last!
    expect(worker.posted).toHaveLength(2)
    expect((worker.posted[0] as { id: number }).id).toBe(1)
    expect((worker.posted[1] as { id: number }).id).toBe(2)

    // 倒序回包也能正确关联
    worker.onmessage?.({ data: { id: 2, ok: true, efforts: [] } })
    await expect(second).resolves.toEqual([])
    worker.onmessage?.({
      data: {
        id: 1,
        ok: true,
        efforts: [{ activityId: 'a', startTime: '2026-08-01', durationSeconds: 10 }],
      },
    })
    await expect(first).resolves.toEqual([
      { activityId: 'a', startTime: '2026-08-01', durationSeconds: 10 },
    ])
  })

  it('worker 出错（onerror）时所有未决请求拒绝', async () => {
    const runner = createLeaderboardRunner()!
    const pending = runner.compute({ segment: SEGMENT, inputs: [] })
    FakeWorker.last!.onerror?.()
    await expect(pending).rejects.toThrow('segment leaderboard worker failed')
  })

  it('cancel 后未决请求以取消错误拒绝并 terminate worker', async () => {
    const runner = createLeaderboardRunner()!
    const pending = runner.compute({ segment: SEGMENT, inputs: [] })
    runner.cancel()
    await expect(pending).rejects.toThrow(LEADERBOARD_CANCELLED)
    expect(FakeWorker.last!.terminated).toBe(true)
  })
})