/**
 * 骑行分段详情（splits）计算。
 *
 * 按累计里程（record.distance，米）把活动切成等长分段：
 * 段末点取首个「累计里程 − 段起里程 ≥ 段长」的记录，段距离按实际值
 * （记录点不一定恰好落在整公里处，可能略超）；最后不足一段按实际距离收尾。
 * 每段输出用时、平均速度（段距离/用时）与平均心率（段内心率点算术平均，
 * 缺失点跳过，全无数据为 undefined，不伪造）。
 * distance 缺失的记录不参与分段边界判断。
 */
import type { ActivityRecord } from '@/types/activity'

/**
 * 单个分段。
 */
export interface Split {
  /** 段序号（1 起） */
  index: number

  /** 段起累计里程（米） */
  startDistance: number

  /** 段末累计里程（米） */
  endDistance: number

  /** 段用时（秒） */
  duration: number

  /** 段平均速度（m/s；用时为 0 时 undefined） */
  avgSpeed: number | undefined

  /** 段平均心率（bpm；段内无心率数据时 undefined） */
  avgHeartRate: number | undefined
}

/**
 * 按段长切分活动。
 *
 * @param records 逐点记录（需含 distance/timestamp）
 * @param splitLengthMeters 段长（米，如 5000 = 5km）
 * @returns 分段列表（无有效距离数据时为空数组）
 */
export function buildSplits(
  records: readonly ActivityRecord[],
  splitLengthMeters: number,
): Split[] {
  const splits: Split[] = []

  // 段起状态：首个带 distance 的记录确定段起里程/时间
  let segmentStartDistance: number | undefined
  let segmentStartTimestamp = 0
  // 段内心率累计（缺失点跳过）
  let heartRateSum = 0
  let heartRateCount = 0

  /**
   * 收尾当前段：段内有正向距离才成段。
   *
   * @param endRecord 段末记录
   */
  function closeSegment(endRecord: ActivityRecord) {
    const startDistance = segmentStartDistance ?? 0
    const distance = endRecord.distance ?? startDistance
    if (distance <= startDistance) {
      return
    }
    const duration = endRecord.timestamp - segmentStartTimestamp
    splits.push({
      index: splits.length + 1,
      startDistance,
      endDistance: distance,
      duration,
      avgSpeed: duration > 0 ? (distance - startDistance) / duration : undefined,
      avgHeartRate: heartRateCount > 0 ? heartRateSum / heartRateCount : undefined,
    })
  }

  /**
   * 重置段内状态（段起=当前记录）。
   *
   * @param record 新段起记录
   */
  function resetSegment(record: ActivityRecord) {
    segmentStartDistance = record.distance
    segmentStartTimestamp = record.timestamp
    heartRateSum = record.heartRate ?? 0
    heartRateCount = record.heartRate === undefined ? 0 : 1
  }

  for (const record of records) {
    if (record.distance === undefined) {
      continue
    }
    if (segmentStartDistance === undefined) {
      resetSegment(record)
      continue
    }
    heartRateSum += record.heartRate ?? 0
    heartRateCount += record.heartRate === undefined ? 0 : 1
    if (record.distance - segmentStartDistance >= splitLengthMeters) {
      closeSegment(record)
      // 下一段从当前记录起算（段末点即下段起点）
      resetSegment(record)
    }
  }

  // 末段不足一段：按实际距离收尾（段起必须已确定）
  if (segmentStartDistance !== undefined) {
    const last = records[records.length - 1]
    if (last.distance !== undefined) {
      // 末段内心率不含段起点重复计数：closeSegment 直接用累计值
      closeSegment(last)
    }
  }
  return splits
}
