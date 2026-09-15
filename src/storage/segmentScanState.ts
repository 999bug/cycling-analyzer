/**
 * 赛段成绩扫描状态（持久化，跨会话复用）。
 *
 * 背景：赛段页原先把成绩榜放在模块级内存缓存里，刷新页面即失效，
 * 于是每次进入都全量拉取全部活动的逐点数据重扫一遍（几十万点级），
 * 表现为「进赛段要等一会儿」。落库的 segment_efforts 才是天然产物，
 * 但需要判断它是否仍然新鲜——本模块把「上次扫描时的数据形态」存进
 * scan_cache，进入赛段页时先读库直出，再按 diff 决定是否补扫。
 *
 * 纳入指纹的只有会影响匹配结果的字段：
 * - 赛段 id 集合（新增赛段 → 该赛段需全量扫，其他赛段成绩不受影响）；
 * - 每个活动的坐标系与纠偏偏移（轨迹纠偏会改变逐点坐标，
 *   改名/改描述等不影响匹配，故不纳入，避免无意义的重扫）。
 *
 * 删除活动时必须同步从状态里剔除（pruneSegmentScanState）：否则同一活动
 * 重新导入后 id 与坐标态都没变，会被判成「无需扫描」，而它的成绩已在删除时
 * 级联清理，表现为重新导入的活动永远没有赛段成绩。
 */
import type { SegmentEntity } from '@/storage/db'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { loadScanCache, saveScanCache } from '@/storage/scanCache'

/** 扫描状态在 scan_cache 表中的缓存名 */
export const SEGMENT_SCAN_CACHE_NAME = 'segments-leaderboard'

/** 状态结构版本：结构变更时递增，旧记录按 fingerprint 失配自动失效 */
export const SEGMENT_SCAN_STATE_VERSION = 'v1'

/** 单活动的坐标态（影响匹配结果的字段） */
export type ActivityScanState = string

/**
 * 上次扫描完成时的赛段与活动形态。
 */
export interface SegmentScanState {
  /** 已扫描的赛段 id 列表 */
  segmentIds: number[]

  /** 活动 id → 该活动的坐标态 */
  activityStates: Record<string, ActivityScanState>
}

/**
 * 计算单个活动的坐标态（坐标系 + 纠偏偏移）。
 *
 * @param summary 活动摘要
 * @returns 坐标态字符串
 */
export function activityScanState(summary: ActivitySummary): ActivityScanState {
  const system = summary.coordinateSystem ?? ''
  const north = summary.trackOffset?.northMeters ?? 0
  const east = summary.trackOffset?.eastMeters ?? 0
  return `${system}|${north},${east}`
}

/**
 * 构造当前数据的扫描状态。
 *
 * @param segments 当前全部赛段
 * @param summaries 当前骑行口径活动摘要
 * @returns 扫描状态
 */
export function buildSegmentScanState(
  segments: readonly SegmentEntity[],
  summaries: readonly ActivitySummary[],
): SegmentScanState {
  const activityStates: Record<string, ActivityScanState> = {}
  for (const summary of summaries) {
    activityStates[summary.id] = activityScanState(summary)
  }
  return {
    segmentIds: segments.map((segment) => segment.id ?? 0),
    activityStates,
  }
}

/**
 * 扫描 diff 结果。
 */
export interface SegmentScanDiff {
  /** 是否需要扫描（false = 落库成绩仍新鲜，直接展示） */
  needsScan: boolean

  /** 是否需要全量扫描（新增赛段：既有赛段成绩未知，只能整批扫） */
  fullRescan: boolean

  /** 本次需要参与匹配的活动 id（空 = 无需扫描） */
  activityIds: string[]
}

/** 无需扫描的 diff（落库成绩仍新鲜） */
const NO_SCAN_DIFF: SegmentScanDiff = { needsScan: false, fullRescan: false, activityIds: [] }

/**
 * 比较上次扫描状态与当前数据形态，得出本次需要扫描的范围。
 *
 * 规则：
 * - 无历史状态 → 全量扫（首次进入或缓存被清空）；
 * - 有新增赛段 → 全量扫（新赛段需要全部活动的成绩）；
 * - 只有活动增删或纠偏 → 只扫这些活动（增量），其余活动的落库成绩继续复用。
 *
 * @param previous 上次扫描状态（null = 无）
 * @param current 当前数据形态
 * @returns 扫描范围
 */
export function diffSegmentScanState(
  previous: SegmentScanState | null,
  current: SegmentScanState,
): SegmentScanDiff {
  if (previous === null) {
    return {
      needsScan: true,
      fullRescan: true,
      activityIds: Object.keys(current.activityStates),
    }
  }
  const knownSegments = new Set(previous.segmentIds)
  const hasNewSegment = current.segmentIds.some((id) => !knownSegments.has(id))
  if (hasNewSegment) {
    return {
      needsScan: true,
      fullRescan: true,
      activityIds: Object.keys(current.activityStates),
    }
  }
  const changed = Object.keys(current.activityStates).filter(
    (id) => previous.activityStates[id] !== current.activityStates[id],
  )
  if (changed.length === 0) {
    return NO_SCAN_DIFF
  }
  return { needsScan: true, fullRescan: false, activityIds: changed }
}

/**
 * 读取持久化的扫描状态。
 *
 * @returns 上次扫描状态；无记录或结构版本失配返回 null
 */
export async function loadSegmentScanState(): Promise<SegmentScanState | null> {
  return loadScanCache<SegmentScanState>(SEGMENT_SCAN_CACHE_NAME, SEGMENT_SCAN_STATE_VERSION)
}

/**
 * 写入扫描状态（扫描成功落库后调用）。
 *
 * @param state 本次扫描完成后的数据形态
 */
export async function saveSegmentScanState(state: SegmentScanState): Promise<void> {
  await saveScanCache(SEGMENT_SCAN_CACHE_NAME, SEGMENT_SCAN_STATE_VERSION, state)
}

/**
 * 从扫描状态里剔除已删除的活动（活动删除级联清理成绩后调用）。
 *
 * @param activityIds 被删除的活动 id
 */
export async function pruneSegmentScanState(activityIds: readonly string[]): Promise<void> {
  const state = await loadSegmentScanState()
  if (state === null || activityIds.length === 0) {
    return
  }
  const removed = new Set(activityIds)
  const activityStates: Record<string, ActivityScanState> = {}
  for (const [id, value] of Object.entries(state.activityStates)) {
    if (!removed.has(id)) {
      activityStates[id] = value
    }
  }
  await saveSegmentScanState({ ...state, activityStates })
}

/**
 * 清空扫描状态（活动被整体清空时调用，下次进入按首次处理）。
 */
export async function clearSegmentScanState(): Promise<void> {
  await saveSegmentScanState({ segmentIds: [], activityStates: {} })
}
