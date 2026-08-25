/**
 * 赛段成绩榜计算任务（worker 与主线程共用，GPX 导入卡死修复）。
 *
 * 与 FIT parseTask 相同的拆分模式：纯函数计算放本模块，
 * worker 只做消息分发，jsdom 测试直接调用 computeLeaderboard
 * （或门面层的同步回退路径），避免 Web Worker 在 jsdom 中无法运行。
 */
import {
  buildSegmentLeaderboard,
  type SegmentActivityInput,
  type SegmentEffort,
  type SegmentGeometry,
} from '@/features/segments/segmentMatching'

/**
 * 单个赛段成绩榜计算输入。
 */
export interface LeaderboardRequest {
  /** 赛段几何（含可选完整轨迹） */
  segment: SegmentGeometry

  /** 参与匹配的活动列表 */
  inputs: readonly SegmentActivityInput[]
}

/**
 * 主线程 → worker 的请求消息。
 */
export interface LeaderboardTaskRequest extends LeaderboardRequest {
  /** 请求编号（主线程用于关联响应） */
  id: number
}

/**
 * worker → 主线程的响应消息。
 */
export type LeaderboardResponse =
  | { id: number; ok: true; efforts: SegmentEffort[] }
  | { id: number; ok: false; errorMessage: string }

/**
 * 计算单个赛段的成绩榜（同步纯函数）。
 *
 * @param request 计算输入
 * @returns 成绩榜（用时升序）
 */
export function computeLeaderboard(request: LeaderboardRequest): SegmentEffort[] {
  return buildSegmentLeaderboard(request.segment, request.inputs)
}
