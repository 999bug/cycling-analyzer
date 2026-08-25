/**
 * 赛段成绩榜 Web Worker（GPX 导入卡死修复）。
 *
 * 职责仅为消息分发：接收主线程的单赛段榜单请求，调用 computeLeaderboard
 * 纯函数，成功回传成绩榜，失败回传错误文案。重量级路径校验
 * （trackMatchesPath 双重循环）在本 worker 执行，避免阻塞主线程。
 */
import { computeLeaderboard, type LeaderboardResponse, type LeaderboardTaskRequest } from './leaderboardTask'

self.onmessage = (event: MessageEvent<LeaderboardTaskRequest>) => {
  const { id } = event.data
  let response: LeaderboardResponse
  try {
    response = { id, ok: true, efforts: computeLeaderboard(event.data) }
  } catch (error) {
    response = { id, ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
