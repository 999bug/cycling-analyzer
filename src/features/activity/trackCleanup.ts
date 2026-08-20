/**
 * 轨迹纠偏（规格 §39 轨迹纠偏）：GPS 漂移点清理纯函数。
 *
 * 识别「飞点」：GPS 信号漂移产生的瞬间离群点——该点与前后点的
 * 瞬时速度均远超骑行可达上限（相当于「跳出去又跳回来」的尖刺）。
 * 清理仅作用于展示层（地图轨迹/GPX 导出），不修改落库逐点数据。
 *
 * 判定规则（保守，避免误删真实高速下坡）：
 * - 仅当该点两侧相邻段的瞬时速度同时超过阈值才删除；
 * - 首末点恒保留（不产生空轨迹/丢端点）；
 * - 无坐标或时间不递增的段不参与判定。
 */
import type { ActivityRecord } from '@/types/activity'
import { haversineMeters, type RouteEndpoint } from '@/features/routes/routeGrouping'

/**
 * 漂移尖刺判定阈值（m/s）：骑行物理可达上限远低于此（约 100+ km/h，
 * 专业下坡也难持续），用于识别 GPS 飞点而非真实高速。
 */
export const DRIFT_SPEED_THRESHOLD_MPS = 50

/**
 * 轨迹纠偏结果。
 */
export interface CleanTrackResult {
  /** 清理后的逐点记录（顺序不变，仅剔除漂移点） */
  cleaned: ActivityRecord[]

  /** 剔除的漂移点数 */
  removedCount: number
}

/**
 * 清理轨迹中的 GPS 漂移点。
 *
 * @param records 完整逐点记录（按时间升序）
 * @param thresholdMps 瞬时速度阈值（默认 DRIFT_SPEED_THRESHOLD_MPS）
 * @returns 清理后轨迹与剔除数
 */
export function cleanTrackDrift(
  records: readonly ActivityRecord[],
  thresholdMps = DRIFT_SPEED_THRESHOLD_MPS,
): CleanTrackResult {
  if (records.length <= 2) {
    return { cleaned: [...records], removedCount: 0 }
  }

  // 仅对含坐标的点计算段速度；无坐标点既非飞点也不被引用
  const coordIndexes = records.reduce<number[]>((acc, record, index) => {
    if (record.latitude !== undefined && record.longitude !== undefined) {
      acc.push(index)
    }
    return acc
  }, [])

  const removed = new Set<number>()
  for (let i = 1; i < coordIndexes.length - 1; i++) {
    const prevIdx = coordIndexes[i - 1]
    const idx = coordIndexes[i]
    const nextIdx = coordIndexes[i + 1]
    const prev = toEndpoint(records[prevIdx])
    const cur = toEndpoint(records[idx])
    const next = toEndpoint(records[nextIdx])

    const prevDt = records[idx].timestamp - records[prevIdx].timestamp
    const nextDt = records[nextIdx].timestamp - records[idx].timestamp
    if (prevDt <= 0 || nextDt <= 0) {
      continue
    }

    const prevSpeed = haversineMeters(prev, cur) / prevDt
    const nextSpeed = haversineMeters(cur, next) / nextDt
    if (prevSpeed > thresholdMps && nextSpeed > thresholdMps) {
      removed.add(idx)
    }
  }

  if (removed.size === 0) {
    return { cleaned: [...records], removedCount: 0 }
  }
  return {
    cleaned: records.filter((_, index) => !removed.has(index)),
    removedCount: removed.size,
  }
}

/**
 * 逐点记录 → 球面距离端点（haversine 用，仅取坐标）。
 *
 * @param record 含坐标的逐点记录
 * @returns 距离端点
 */
function toEndpoint(record: ActivityRecord): RouteEndpoint {
  return { latitude: record.latitude!, longitude: record.longitude! }
}