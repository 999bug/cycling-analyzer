/**
 * 赛段成绩榜 worker 客户端测试（GPX 导入卡死修复 + 批量协议）。
 *
 * mock 全局 Worker 验证批量消息协议：请求携带自增 id + segments 数组 +
 * 共享 inputs；响应 boards 按赛段起点坐标键索引，主线程反查回 SegmentGeometry
 * 对象。验证 onerror 拒绝所有未决请求、cancel 以取消错误拒绝并 terminate。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLeaderboardRunner,
  LEADERBOARD_CANCELLED,
} from '@/features/segments/leaderboardClient'
import type { SegmentEffort, SegmentGeometry } from '@/features/segments/segmentMatching'

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

const SEGMENT_A: SegmentGeometry = {
  startLatitude: 31.2,
  startLongitude: 121.5,
  endLatitude: 31.3,
  endLongitude: 121.6,
}
const SEGMENT_B: SegmentGeometry = {
  startLatitude: 40.0,
  startLongitude: 116.4,
  endLatitude: 40.1,
  endLongitude: 116.5,
}

/** 与 leaderboardTask.segmentBoardKey 内部一致：6 位小数 */
function keyOf(segment: SegmentGeometry): string {
  return `${segment.startLatitude.toFixed(6)},${segment.startLongitude.toFixed(6)}`
}

describe('leaderboardClient', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWorker.last = null
  })

  it('compute 一次发送 segments + 共享 inputs 请求，响应按 id 关联', async () => {
    const runner = createLeaderboardRunner()
    expect(runner).not.toBeNull()

    const first = runner!.compute({ segments: [SEGMENT_A, SEGMENT_B], inputs: [] })
    const second = runner!.compute({ segments: [SEGMENT_A], inputs: [] })

    const worker = FakeWorker.last!
    expect(worker.posted).toHaveLength(2)
    expect((worker.posted[0] as { id: number }).id).toBe(1)
    expect((worker.posted[1] as { id: number }).id).toBe(2)
    // 一次请求携带所有 segments
    expect((worker.posted[0] as { segments: unknown[] }).segments).toHaveLength(2)
    expect((worker.posted[0] as { inputs: unknown[] }).inputs).toEqual([])

    // 倒序回包也能正确关联
    const effortsA: SegmentEffort[] = [
      { activityId: 'a', startTime: '2026-08-01', durationSeconds: 10 },
    ]
    worker.onmessage?.({ data: { id: 2, ok: true, boards: { [keyOf(SEGMENT_A)]: effortsA } } })
    await expect(second).resolves.toEqual(new Map([[SEGMENT_A, effortsA]]))
    worker.onmessage?.({
      data: {
        id: 1,
        ok: true,
        boards: {
          [keyOf(SEGMENT_A)]: effortsA,
          [keyOf(SEGMENT_B)]: [],
        },
      },
    })
    await expect(first).resolves.toEqual(
      new Map([
        [SEGMENT_A, effortsA],
        [SEGMENT_B, []],
      ]),
    )
  })

  it('boards 缺失某赛段键时返回空榜而非 undefined', async () => {
    const runner = createLeaderboardRunner()!
    const promise = runner.compute({ segments: [SEGMENT_A, SEGMENT_B], inputs: [] })
    // worker 只回 A，不回 B——主线程应补空榜
    FakeWorker.last!.onmessage?.({
      data: { id: 1, ok: true, boards: { [keyOf(SEGMENT_A)]: [] } },
    })
    const result = await promise
    expect(result.get(SEGMENT_A)).toEqual([])
    expect(result.get(SEGMENT_B)).toEqual([])
  })

  it('worker 出错（onerror）时所有未决请求拒绝', async () => {
    const runner = createLeaderboardRunner()!
    const pending = runner.compute({ segments: [SEGMENT_A], inputs: [] })
    FakeWorker.last!.onerror?.()
    await expect(pending).rejects.toThrow('segment leaderboard worker failed')
  })

  it('cancel 后未决请求以取消错误拒绝并 terminate worker', async () => {
    const runner = createLeaderboardRunner()!
    const pending = runner.compute({ segments: [SEGMENT_A], inputs: [] })
    runner.cancel()
    await expect(pending).rejects.toThrow(LEADERBOARD_CANCELLED)
    expect(FakeWorker.last!.terminated).toBe(true)
  })
})
