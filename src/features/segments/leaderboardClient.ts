/**
 * 主线程侧成绩榜 worker 客户端（GPX 导入卡死修复）。
 *
 * createLeaderboardRunner 创建常驻 worker：每批一次请求（segments + 共享 inputs），
 * 避免 N 赛段 × N 记录的结构化克隆风暴。cancel() 终止 worker（页面卸载/重
 * 新加载时调用，未决 Promise 以取消错误拒绝）。jsdom 无 Worker 时返回 null，
 * 调用方回退主线程同步计算（computeBatchLeaderboards 纯函数）。
 */
import {
  computeBatchLeaderboards,
  segmentBoardKey,
  type LeaderboardBatchRequest,
  type LeaderboardWorkerMessage,
} from './leaderboardTask'
import type { SegmentEffort, SegmentGeometry } from './segmentMatching'

/** 批量成绩榜计算函数（worker 异步版）：一次提交多赛段，返回按赛段键索引的榜 */
export type LeaderboardBatchFn = (
  request: LeaderboardBatchRequest,
) => Promise<Map<SegmentGeometry, SegmentEffort[]>>

/** 取消错误消息（调用方据此区分「主动取消」与真实失败） */
export const LEADERBOARD_CANCELLED = 'leaderboard computation cancelled'

/**
 * 创建基于 Web Worker 的批量榜单计算器。
 *
 * @returns 计算器（compute + cancel）；环境不支持 Worker 时返回 null
 */
export function createLeaderboardRunner(): {
  compute: LeaderboardBatchFn
  cancel: () => void
} | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  const worker = new Worker(new URL('./leaderboardWorker.ts', import.meta.url), {
    type: 'module',
  })
  const pending = new Map<number, (response: LeaderboardWorkerMessage) => void>()
  let nextId = 1

  worker.onmessage = (event: MessageEvent<LeaderboardWorkerMessage>) => {
    const resolve = pending.get(event.data.id)
    if (resolve) {
      pending.delete(event.data.id)
      resolve(event.data)
    }
  }

  // worker 加载或运行失败：拒绝所有未决请求，避免 Promise 悬挂
  worker.onerror = () => {
    for (const resolve of pending.values()) {
      resolve({ id: 0, ok: false, errorMessage: 'segment leaderboard worker failed' })
    }
    pending.clear()
  }

  return {
    compute: (request) =>
      new Promise((resolvePromise, rejectPromise) => {
        const id = nextId++
        pending.set(id, (response) => {
          if (response.ok && 'boards' in response) {
            // 批量响应：将 worker 返回的 record 反查回原 SegmentGeometry 对象
            // （同一份 segment 对象不在 inputs 中，可靠 key 对齐）
            const boards = new Map<SegmentGeometry, SegmentEffort[]>()
            for (const segment of request.segments) {
              const key = segmentBoardKey(segment)
              boards.set(segment, response.boards[key] ?? [])
            }
            resolvePromise(boards)
          } else if (response.ok) {
            // 理论不会走到这里：单赛段协议已下架
            resolvePromise(new Map())
          } else {
            rejectPromise(new Error(response.errorMessage))
          }
        })
        try {
          worker.postMessage({ ...request, id })
        } catch (error) {
          pending.delete(id)
          rejectPromise(error instanceof Error ? error : new Error(String(error)))
        }
      }),
    // terminate 后未决请求不会再有响应：统一以取消错误拒绝，防止悬挂
    cancel: () => {
      for (const resolve of pending.values()) {
        resolve({ id: 0, ok: false, errorMessage: LEADERBOARD_CANCELLED })
      }
      pending.clear()
      worker.terminate()
    },
  }
}

/**
 * 主线程同步回退路径（jsdom / 无 Worker 环境）：直接调纯函数，
 * 返回与 worker 接口等价的 Map。
 */
export function computeLeaderboardsSync(
  request: LeaderboardBatchRequest,
): Map<SegmentGeometry, SegmentEffort[]> {
  const boards = new Map<SegmentGeometry, SegmentEffort[]>()
  for (const segment of request.segments) {
    const key = segmentBoardKey(segment)
    boards.set(segment, computeBatchLeaderboards(request)[key] ?? [])
  }
  return boards
}
