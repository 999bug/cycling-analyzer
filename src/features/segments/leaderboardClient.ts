/**
 * 主线程侧成绩榜 worker 客户端（GPX 导入卡死修复）。
 *
 * createLeaderboardRunner 创建常驻 worker：每个赛段榜单一个请求，
 * 顺序复用；cancel() 终止 worker（页面卸载/重新加载时调用，
 * 未决 Promise 以取消错误拒绝）。jsdom 无 Worker 时返回 null，
 * 调用方回退主线程同步计算（computeLeaderboard 纯函数）。
 */
import type { LeaderboardRequest, LeaderboardResponse } from './leaderboardTask'

/** 成绩榜计算函数（worker 异步版） */
export type LeaderboardFn = (
  request: LeaderboardRequest,
) => Promise<import('@/features/segments/segmentMatching').SegmentEffort[]>

/** 取消错误消息（调用方据此区分「主动取消」与真实失败） */
export const LEADERBOARD_CANCELLED = 'leaderboard computation cancelled'

/**
 * 创建基于 Web Worker 的榜单计算器。
 *
 * @returns 计算器（compute + cancel）；环境不支持 Worker 时返回 null
 */
export function createLeaderboardRunner(): {
  compute: LeaderboardFn
  cancel: () => void
} | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  const worker = new Worker(new URL('./leaderboardWorker.ts', import.meta.url), {
    type: 'module',
  })
  const pending = new Map<number, (response: LeaderboardResponse) => void>()
  let nextId = 1

  worker.onmessage = (event: MessageEvent<LeaderboardResponse>) => {
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
          if (response.ok) {
            resolvePromise(response.efforts)
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
