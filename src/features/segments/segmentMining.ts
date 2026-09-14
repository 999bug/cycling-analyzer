/**
 * 本地赛段挖掘纯函数（赛段重设计三期：高频路段自动推荐）。
 *
 * 思路（Strava 赛段的个人版——「我常骑的路段」）：
 * 1. **热力网格**：把所有活动轨迹点落入 ~222m（0.002°）网格，统计每格
 *    被多少个**不同活动**经过（去重活动数，单次活动反复折返只算 1）；
 * 2. **高频格对**：对每条活动，取其经过的热格有序序列（相邻去重），
 *    统计相邻热格对（中心直线距 0.3–1.2 km）的共现活动数；
 * 3. **候选段**：共现数达阈值的热格对即候选赛段——起终点圆取格中心
 *    （半径 200m 的既有匹配口径），轨迹切片从「两格命中跨度最小」的
 *    代表活动截取，供路径校验与距离展示。
 *
 * 设计取舍：
 * - 格中心做端点比从轨迹点直接取端点**稳定得多**（端点漂移是自动建段
 *   的头号失败源）；格径 222m vs 匹配圆 200m 同量级；
 * - 相邻热格对用**直线距**近似路段长（弯道会被低估而漏挖，v1 已知限制，
 *   换路径距需接路网图，工程量不成比例）；
 * - 采样计数（默认每 5 点取 1）对 222m 网格精度无损，纯计数开销可控；
 * - 候选段的真实命中数由调用方用既有匹配器（matchSegmentEffortDetail /
 *   leaderboard runner）复核，本模块只产出候选。
 */
import type { ActivityRecord } from '@/types/activity'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 挖掘参数（全部有默认值，可覆盖调参） */
export interface MiningParams {
  /** 网格边长（度，0.002° ≈ 222m） */
  gridDegrees: number

  /** 热格门槛：经过的不同活动数下限 */
  minCellActivities: number

  /** 候选门槛：热格对共现活动数下限 */
  minPairHits: number

  /** 候选段起终点直线距范围（米，对应推荐赛段长度量级） */
  minPairMeters: number
  maxPairMeters: number

  /** 最多返回候选数（按共现数降序截断） */
  maxCandidates: number

  /** 计数采样步长（每 N 点取 1，精度对网格无损） */
  sampleStep: number
}

/** 默认参数 */
export const DEFAULT_MINING_PARAMS: MiningParams = {
  gridDegrees: 0.002,
  minCellActivities: 6,
  minPairHits: 5,
  minPairMeters: 300,
  maxPairMeters: 1200,
  maxCandidates: 15,
  sampleStep: 5,
}

/** 挖掘输入：一条活动 */
export interface MiningInput {
  activityId: string
  records: readonly ActivityRecord[]
}

/** 候选赛段（真实命中数由调用方用匹配器复核） */
export interface SegmentCandidate {
  /** 起点（起点圆心，原始记录坐标） */
  startLatitude: number
  startLongitude: number

  /** 终点（终点圆心） */
  endLatitude: number
  endLongitude: number

  /** 代表活动截取的轨迹切片（原始坐标，路径校验/距离展示用） */
  trackPoints: [number, number][]

  /** 路段路径距离（米，沿代表活动轨迹累加） */
  distanceMeters: number

  /** 共现活动数（热格对计数，真实命中数的代理） */
  coOccurrence: number
}

/** 网格 key（含格中心，中心由 key 反算） */
interface HotCell {
  centerLatitude: number
  centerLongitude: number
  /** 经过该格的不同活动数 */
  activities: number

  /** 每活动首次命中的记录索引（候选轨迹截取用） */
  firstIndexByActivity: Map<string, number>
}

/** 热格对共现记录 */
interface PairStat {
  cellA: string
  cellB: string
  count: number

  /** 各活动中该对的首个命中索引（轨迹截取候选） */
  spans: Map<string, { indexA: number; indexB: number }>
}

function cellKeyOf(latitude: number, longitude: number, gridDegrees: number): string {
  return `${Math.round(latitude / gridDegrees)}:${Math.round(longitude / gridDegrees)}`
}

function cellCenter(key: string, gridDegrees: number): { latitude: number; longitude: number } {
  const [a, b] = key.split(':')
  return { latitude: Number(a) * gridDegrees, longitude: Number(b) * gridDegrees }
}

/**
 * 从活动集合挖掘高频路段候选。
 *
 * @param inputs 参与挖掘的活动（建议骑行摘要 + 完整逐点）
 * @param params 挖掘参数（缺省用 DEFAULT_MINING_PARAMS）
 * @returns 候选段列表（按共现数降序，已做候选间去重）
 */
export function mineSegmentCandidates(
  inputs: readonly MiningInput[],
  params: MiningParams = DEFAULT_MINING_PARAMS,
): SegmentCandidate[] {
  const hotCells = new Map<string, HotCell>()

  // 1. 热力网格：格 → 不同活动数 + 各活动首命中索引
  for (const input of inputs) {
    const seenCells = new Set<string>()
    const firstIndexByCell = new Map<string, number>()
    for (let i = 0; i < input.records.length; i += params.sampleStep) {
      const record = input.records[i]
      if (record?.latitude === undefined || record?.longitude === undefined) {
        continue
      }
      const key = cellKeyOf(record.latitude, record.longitude, params.gridDegrees)
      if (!seenCells.has(key)) {
        seenCells.add(key)
        firstIndexByCell.set(key, i)
      }
    }
    for (const key of seenCells) {
      let cell = hotCells.get(key)
      if (cell === undefined) {
        const center = cellCenter(key, params.gridDegrees)
        cell = {
          centerLatitude: center.latitude,
          centerLongitude: center.longitude,
          activities: 0,
          firstIndexByActivity: new Map(),
        }
        hotCells.set(key, cell)
      }
      cell.activities += 1
      cell.firstIndexByActivity.set(input.activityId, firstIndexByCell.get(key) ?? 0)
    }
  }

  // 过滤热格
  const hot = new Map<string, HotCell>()
  for (const [key, cell] of hotCells) {
    if (cell.activities >= params.minCellActivities) {
      hot.set(key, cell)
    }
  }
  if (hot.size < 2) {
    return []
  }

  // 2. 热格对共现计数：活动内热格序列的滑动窗口配对。
  //    窗口深度 4：0.4~1.2km 的路段跨 2~5 个格，仅看相邻对会被 300m 下限全滤掉
  const WINDOW_DEPTH = 4
  const pairs = new Map<string, PairStat>()
  for (const input of inputs) {
    const history: { key: string; index: number }[] = []
    for (let i = 0; i < input.records.length; i += params.sampleStep) {
      const record = input.records[i]
      if (record?.latitude === undefined || record?.longitude === undefined) {
        continue
      }
      const key = cellKeyOf(record.latitude, record.longitude, params.gridDegrees)
      if (!hot.has(key) || history.some((entry) => entry.key === key)) {
        continue
      }
      for (const past of history) {
        const cellA = hot.get(past.key)!
        const cellB = hot.get(key)!
        const centerDistance = haversineMeters(
          { latitude: cellA.centerLatitude, longitude: cellA.centerLongitude },
          { latitude: cellB.centerLatitude, longitude: cellB.centerLongitude },
        )
        if (centerDistance < params.minPairMeters || centerDistance > params.maxPairMeters) {
          continue
        }
        // 无序对 key（A/B 按字典序），正反骑都计入同一路段
        const [keyA, keyB] = [past.key, key].sort()
        const pairKey = `${keyA}|${keyB}`
        let stat = pairs.get(pairKey)
        if (stat === undefined) {
          stat = { cellA: keyA, cellB: keyB, count: 0, spans: new Map() }
          pairs.set(pairKey, stat)
        }
        // 该活动首次出现的跨度（截取代表轨迹用）
        if (!stat.spans.has(input.activityId)) {
          const [indexA, indexB] = key === keyB ? [past.index, i] : [i, past.index]
          stat.spans.set(input.activityId, {
            indexA: Math.min(indexA, indexB),
            indexB: Math.max(indexA, indexB),
          })
        }
        stat.count += 1
      }
      history.push({ key, index: i })
      if (history.length > WINDOW_DEPTH) {
        history.shift()
      }
    }
  }

  // 3. 过滤 + 排序 + 截断 + 候选间去重（中点互近 = 同一走廊的嵌套变体）。
  //    阈值取 maxPairMeters：GPS 抖动会让同一走廊跨多条格带产生多个变体，
  //    宁可少推荐也不推重复段（平行街道相距通常 > 1.2km，不受影响）
  const corridorMidNearMeters = params.maxPairMeters
  const accepted: SegmentCandidate[] = []
  const sorted = [...pairs.values()]
    .filter((stat) => {
      // 共现按「不同活动数」口径：spans 数才是去重活动数
      return stat.spans.size >= params.minPairHits
    })
    .sort((a, b) => b.spans.size - a.spans.size)

  for (const stat of sorted) {
    if (accepted.length >= params.maxCandidates) {
      break
    }
    const cellA = hot.get(stat.cellA)!
    const cellB = hot.get(stat.cellB)!
    const midLatitude = (cellA.centerLatitude + cellB.centerLatitude) / 2
    const midLongitude = (cellA.centerLongitude + cellB.centerLongitude) / 2
    // 候选间去重：中点距离近视为同一路廊（长段与其嵌套子段/错位变体同源）
    const duplicate = accepted.some((candidate) => {
      const candidateMidLatitude =
        (candidate.startLatitude + candidate.endLatitude) / 2
      const candidateMidLongitude =
        (candidate.startLongitude + candidate.endLongitude) / 2
      return (
        haversineMeters(
          { latitude: midLatitude, longitude: midLongitude },
          { latitude: candidateMidLatitude, longitude: candidateMidLongitude },
        ) < corridorMidNearMeters
      )
    })
    if (duplicate) {
      continue
    }

    // 代表轨迹：取「两格命中跨度最小」的活动切片（最贴近该路段的完整穿越）
    let bestSpan: { activityId: string; indexA: number; indexB: number } | undefined
    for (const [activityId, span] of stat.spans) {
      if (bestSpan === undefined || span.indexB - span.indexA < bestSpan.indexB - bestSpan.indexA) {
        bestSpan = { activityId, indexA: span.indexA, indexB: span.indexB }
      }
    }
    if (bestSpan === undefined) {
      continue
    }
    const source = inputs.find((input) => input.activityId === bestSpan!.activityId)
    if (source === undefined) {
      continue
    }
    const trackPoints: [number, number][] = []
    let distanceMeters = 0
    let previous: { latitude: number; longitude: number } | undefined
    for (let i = bestSpan.indexA; i <= bestSpan.indexB && i < source.records.length; i += 1) {
      const record = source.records[i]
      if (record?.latitude === undefined || record?.longitude === undefined) {
        continue
      }
      trackPoints.push([record.latitude, record.longitude])
      if (previous !== undefined) {
        distanceMeters += haversineMeters(previous, {
          latitude: record.latitude,
          longitude: record.longitude,
        })
      }
      previous = { latitude: record.latitude, longitude: record.longitude }
    }
    if (trackPoints.length < 2) {
      continue
    }

    accepted.push({
      startLatitude: cellA.centerLatitude,
      startLongitude: cellA.centerLongitude,
      endLatitude: cellB.centerLatitude,
      endLongitude: cellB.centerLongitude,
      trackPoints,
      distanceMeters,
      coOccurrence: stat.spans.size,
    })
  }
  return accepted
}

/**
 * 过滤与既有赛段重复的候选：起终点都与某既有赛段互近（< 250m，含反向）
 * 视为重复，不再推荐。
 *
 * @param candidates 挖掘候选
 * @param existing 既有赛段（起终点圆心）
 * @returns 未重复的候选
 */
export function filterCandidatesAgainstExisting(
  candidates: readonly SegmentCandidate[],
  existing: readonly { startLatitude: number; startLongitude: number; endLatitude: number; endLongitude: number }[],
  nearMeters = 250,
): SegmentCandidate[] {
  const near = (lat1: number, lng1: number, lat2: number, lng2: number) =>
    haversineMeters({ latitude: lat1, longitude: lng1 }, { latitude: lat2, longitude: lng2 }) < nearMeters
  return candidates.filter(
    (candidate) =>
      !existing.some(
        (segment) =>
          (near(candidate.startLatitude, candidate.startLongitude, segment.startLatitude, segment.startLongitude) &&
            near(candidate.endLatitude, candidate.endLongitude, segment.endLatitude, segment.endLongitude)) ||
          (near(candidate.startLatitude, candidate.startLongitude, segment.endLatitude, segment.endLongitude) &&
            near(candidate.endLatitude, candidate.endLongitude, segment.startLatitude, segment.startLongitude)),
      ),
  )
}
