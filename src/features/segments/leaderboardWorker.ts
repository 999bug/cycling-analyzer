/**
 * 赛段成绩榜 Web Worker（GPX 导入卡死修复）。
 *
 * 职责仅为消息分发：接收主线程的批量榜单请求，调用 computeBatchLeaderboards
 * 纯函数，成功回传按起点坐标索引的成绩榜 map，失败回传错误文案。
 *
 * 支持两种消息协议：
 * - 批量（推荐，赛段页 N+1 修复）：{ segments, inputs, id } → { boards, id }
 * - 单赛段（兼容老测试）：{ segment, inputs, id } → { efforts, id }
 *
 * 重量级路径校验（trackMatchesPath 双重循环）在本 worker 执行，
 * 避免阻塞主线程。
 */
import {
  computeBatchLeaderboards,
  computeLeaderboard,
  type LeaderboardBatchTaskRequest,
  type LeaderboardTaskRequest,
  type LeaderboardWorkerMessage,
} from './leaderboardTask'

self.onmessage = (
  event: MessageEvent<LeaderboardTaskRequest | LeaderboardBatchTaskRequest>,
) => {
  const { id } = event.data
  let response: LeaderboardWorkerMessage
  try {
    if ('segments' in event.data) {
      // 批量协议：一次提交多赛段，共享 inputs
      response = { id, ok: true, boards: computeBatchLeaderboards(event.data) }
    } else {
      // 单赛段协议：保留兼容
      response = { id, ok: true, efforts: computeLeaderboard(event.data) }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    response = { id, ok: false, errorMessage }
  }
  self.postMessage(response)
}

export {}
