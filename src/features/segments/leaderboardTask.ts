/**
 * 赛段成绩榜计算任务（worker 与主线程共用，GPX 导入卡死修复）。
 *
 * 与 FIT parseTask 相同的拆分模式：纯函数计算放本模块，
 * worker 只做消息分发，jsdom 测试直接调用 computeLeaderboard
 * （或门面层的同步回退路径），避免 Web Worker 在 jsdom 中无法运行。
 *
 * 批计算协议：主线程一次 postMessage 提交全部赛段 + 共享 inputs，
 * worker 内部循环计算后统一返回映射表，避免 N 赛段 × N 记录的结构化
 * 克隆风暴。个人典型数据 200 活动 × 8000 点 ≈ 160 万对象 × N 赛段
 * 反复克隆是页面卡死的根因。
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
 * 批量赛段成绩榜计算输入：一次提交多个赛段，复用同一份 inputs。
 */
export interface LeaderboardBatchRequest {
  /** 待计算的赛段列表 */
  segments: readonly SegmentGeometry[]

  /** 参与匹配的活动列表（共享，避免逐赛段重复克隆） */
  inputs: readonly SegmentActivityInput[]
}

/**
 * 主线程 → worker 的单赛段请求消息。
 */
export interface LeaderboardTaskRequest extends LeaderboardRequest {
  /** 请求编号（主线程用于关联响应） */
  id: number
}

/**
 * 主线程 → worker 的批量请求消息。
 */
export interface LeaderboardBatchTaskRequest extends LeaderboardBatchRequest {
  /** 请求编号（主线程用于关联响应） */
  id: number
}

/**
 * worker → 主线程的单赛段响应消息。
 */
export type LeaderboardResponse =
  | { id: number; ok: true; efforts: SegmentEffort[] }
  | { id: number; ok: false; errorMessage: string }

/**
 * worker → 主线程的批量响应消息：boards 按 segmentId 索引（SegmentGeometry
 * 无自增 id 字段，使用对象引用——为避免结构化克隆后引用丢失，键采用
 * 起点纬度/经度拼接保证确定性）。
 */
export type LeaderboardBatchResponse =
  | {
      id: number
      ok: true
      /** key = `${startLat},${startLng}`，主线程按此还原到 boards map */
      boards: Record<string, SegmentEffort[]>
    }
  | { id: number; ok: false; errorMessage: string }

/**
 * worker 实际 postMessage 出去的消息类型（单赛段 + 批量响应联合），
 * 供 Worker 端 onmessage 与主线程 onmessage 共享使用。
 */
export type LeaderboardWorkerMessage = LeaderboardResponse | LeaderboardBatchResponse

/**
 * 计算单个赛段的成绩榜（同步纯函数）。
 *
 * @param request 计算输入
 * @returns 成绩榜（用时升序）
 */
export function computeLeaderboard(request: LeaderboardRequest): SegmentEffort[] {
  return buildSegmentLeaderboard(request.segment, request.inputs)
}

/**
 * 批量计算多个赛段的成绩榜（同步纯函数）。
 *
 * @param request 批量计算输入
 * @returns 按赛段起点坐标键索引的成绩榜映射
 */
export function computeBatchLeaderboards(
  request: LeaderboardBatchRequest,
): Record<string, SegmentEffort[]> {
  const boards: Record<string, SegmentEffort[]> = {}
  for (const segment of request.segments) {
    const key = segmentBoardKey(segment)
    boards[key] = buildSegmentLeaderboard(segment, request.inputs)
  }
  return boards
}

/**
 * 生成赛段键（与 computeBatchLeaderboards 内部一致；供主线程按赛段对象反查）。
 *
 * 坐标保留 6 位小数（≈ 0.11m 精度）避免浮点漂移，足够区分起终点。
 */
export function segmentBoardKey(segment: SegmentGeometry): string {
  return `${segment.startLatitude.toFixed(6)},${segment.startLongitude.toFixed(6)}`
}
