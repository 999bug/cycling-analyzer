/**
 * 活动详情页「本次赛段」区块（赛段重设计一期）。
 *
 * 实时匹配本次骑行经过的赛段，并对比个人最好成绩（PR）：
 * - 快于历史最好 → 「新纪录」徽章（绿色）；
 * - 进入个人前三 → 「个人第 N」徽章；
 * - 其余显示与最好成绩的差值（快绿慢红）。
 *
 * 数据来源：
 * - 本地源：赛段定义来自 segments 表，历史成绩来自 segment_efforts 表（v6 落库），
 *   匹配结果增量回写（upsert），供赛段页 / 赛段详情页免重扫直接读库；
 * - 作者源：赛段定义与全量成绩榜均为 CI 预计算快照（segments.json +
 *   precomputed/segment-results.json），只读不回写。
 *
 * 性能：匹配为 N 赛段 × 1 活动的单次线性扫描（典型 < 20 赛段 × 万级点，
 * 主线程一次完成可接受）；全量扫描（N 赛段 × N 活动）仍只在赛段页发生。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ActivityRecord } from '@/types/activity'
import { db, type SegmentEntity } from '@/storage/db'
import {
  DexieSegmentRepository,
  type SegmentRepository,
} from '@/storage/repositories/segmentRepository'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import {
  matchSegmentEffortDetail,
  type SegmentEffort,
} from '@/features/segments/segmentMatching'
import { computeEffortMetrics } from '@/features/segments/effortMetrics'
import { segmentDistanceMeters } from '@/features/segments/segmentStats'
import { formatDuration } from '@/utils/format'
import './activityMatchedSegments.css'

/** 默认仓库（组件注入点，测试传内存实现） */
const defaultRepository = new DexieSegmentRepository(db)

/** 快照客户端类型（仅取类型，便于测试注入） */
type SnapshotClient = typeof defaultSnapshotClient

/** 单行展示数据 */
interface MatchedSegmentView {
  /** 赛段 id（详情页链接；缺失时名称不可点击） */
  segmentId?: number

  /** 赛段名称 */
  name: string

  /** 本次穿越用时（秒） */
  durationSeconds: number

  /** 赛段距离（km；无轨迹时为起终点直线距离） */
  distanceKm: number

  /** 距离是否为直线估算（赛段无轨迹点时） */
  distanceEstimated: boolean

  /** 除本次外的历史最好成绩（秒）；undefined = 本次是该赛段首条成绩 */
  prSeconds?: number

  /** 含本次在内的排名（1 起） */
  rank: number
}

/** 加载状态 */
type LoadState = 'loading' | 'ready' | 'error'

/**
 * 差值格式化：±Ns（< 60s）或 ±M:SS（≥ 60s）。
 *
 * @param diffSeconds 与最好成绩的差值（正 = 慢，负 = 快）
 */
function formatDelta(diffSeconds: number): string {
  const sign = diffSeconds >= 0 ? '+' : '-'
  const abs = Math.abs(diffSeconds)
  if (abs >= 60) {
    const minutes = Math.floor(abs / 60)
    const seconds = Math.round(abs % 60)
    return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`
  }
  return `${sign}${Math.round(abs)}s`
}

/**
 * 组件 props。
 */
export interface ActivityMatchedSegmentsProps {
  /** 当前活动 ID */
  activityId: string

  /** 活动开始时间（ISO 8601，成绩回写 startTime 用） */
  startTime: string

  /** 活动完整逐点数据（未抽稀） */
  records: readonly ActivityRecord[]

  /** 当前数据源（local / author） */
  source: 'local' | 'author'

  /** 赛段仓库注入（测试用） */
  repository?: SegmentRepository

  /** 快照客户端注入（测试用） */
  snapshotClient?: SnapshotClient
}

/**
 * 活动详情页「本次赛段」区块。
 *
 * @param props 组件参数
 */
function ActivityMatchedSegments({
  activityId,
  startTime,
  records,
  source,
  repository = defaultRepository,
  snapshotClient = defaultSnapshotClient,
}: ActivityMatchedSegmentsProps) {
  const [state, setState] = useState<LoadState>('loading')
  const [items, setItems] = useState<MatchedSegmentView[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 重置上次匹配残留（异步 IIFE 内调用，避免 effect 同步 setState 连锁渲染）
      setState('loading')
      setItems([])
      try {
        // 赛段定义与历史成绩按源分流（作者源为 CI 预计算，只读）
        let segments: SegmentEntity[] = []
        const resultsById = new Map<number, SegmentEffort[]>()
        if (source === 'author') {
          segments = await snapshotClient.getSegments().catch(() => [] as SegmentEntity[])
          const results = await snapshotClient
            .getSegmentResults()
            .catch(() => ({}) as Record<string, SegmentEffort[]>)
          for (const [key, efforts] of Object.entries(results)) {
            resultsById.set(Number(key), efforts)
          }
        } else {
          segments = await repository.listSegments()
        }
        if (cancelled) {
          return
        }

        const views: MatchedSegmentView[] = []
        for (const segment of segments) {
          const match = matchSegmentEffortDetail(segment, records)
          if (match === undefined) {
            continue
          }
          const segmentId = segment.id ?? 0
          const metrics = computeEffortMetrics(records, match.startTimestamp, match.endTimestamp)

          // 历史成绩（排除本次）求最好成绩与排名
          let efforts: SegmentEffort[] = []
          if (source === 'author') {
            efforts = [...(resultsById.get(segmentId) ?? [])]
          } else {
            efforts = (await repository.listEffortsBySegment(segmentId)).map((effort) => ({
              activityId: effort.activityId,
              startTime: effort.startTime,
              durationSeconds: effort.durationSeconds,
              avgSpeed: effort.avgSpeed,
              avgPower: effort.avgPower,
              avgHeartRate: effort.avgHeartRate,
            }))
          }
          const others = efforts
            .filter((effort) => effort.activityId !== activityId)
            .sort((a, b) => a.durationSeconds - b.durationSeconds)
          const prSeconds = others[0]?.durationSeconds
          const rank = others.filter((effort) => effort.durationSeconds < match.durationSeconds).length + 1

          // 本地源：实时匹配结果增量回写（详情页浏览即保持成绩库新鲜）
          if (source === 'local') {
            await repository
              .upsertActivityEffort(segmentId, activityId, {
                startTime,
                durationSeconds: match.durationSeconds,
                avgSpeed: metrics.avgSpeed,
                avgPower: metrics.avgPower,
                avgHeartRate: metrics.avgHeartRate,
              })
              .catch((error: unknown) => {
                console.error('Failed to upsert segment effort', error)
              })
          }

          const distance = segmentDistanceMeters(segment)
          views.push({
            segmentId: segment.id,
            name: segment.name,
            durationSeconds: match.durationSeconds,
            distanceKm: distance.meters / 1000,
            distanceEstimated: distance.estimated,
            prSeconds,
            rank,
          })
          if (cancelled) {
            return
          }
        }
        if (!cancelled) {
          setItems(views)
          setState('ready')
        }
      } catch (error: unknown) {
        console.error('Failed to match activity segments', error)
        if (!cancelled) {
          setState('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activityId, startTime, records, source, repository, snapshotClient])

  // 无赛段 / 未穿越 / 加载中：整块不渲染（不打扰无赛段用户的详情页）
  if (state !== 'ready' || items.length === 0) {
    return null
  }

  return (
    <section className="matched-segments" aria-label="本次赛段">
      <h2 className="matched-segments__title">本次赛段</h2>
      <p className="matched-segments__hint">经过 {items.length} 个赛段 · 对比个人最好成绩</p>
      <div className="matched-segments__list">
        {items.map((item) => {
          const isNewRecord =
            item.prSeconds !== undefined && item.durationSeconds < item.prSeconds
          const diff = item.prSeconds !== undefined ? item.durationSeconds - item.prSeconds : undefined
          const nameBody = (
            <>
              <span className="matched-segments__name">{item.name}</span>
              <span className="matched-segments__meta">
                {item.distanceKm.toFixed(2)} km{item.distanceEstimated ? '（直线）' : ''}
                {item.prSeconds !== undefined && ` · 最好 ${formatDuration(item.prSeconds)}`}
              </span>
            </>
          )
          return (
            <div key={item.segmentId ?? item.name} className="matched-segments__row">
              <div className="matched-segments__main">
                {item.segmentId !== undefined && item.segmentId > 0 ? (
                  <Link className="matched-segments__link" to={`/segments/${item.segmentId}`}>
                    {nameBody}
                  </Link>
                ) : (
                  nameBody
                )}
              </div>
              <div className="matched-segments__result">
                {isNewRecord ? (
                  <span className="matched-segments__badge matched-segments__badge--record">新纪录</span>
                ) : item.prSeconds === undefined ? (
                  <span className="matched-segments__badge">首条成绩</span>
                ) : item.rank <= 3 ? (
                  <span className="matched-segments__badge matched-segments__badge--podium">
                    个人第 {item.rank}
                  </span>
                ) : null}
                <span className="matched-segments__time">{formatDuration(item.durationSeconds)}</span>
                {diff !== undefined && (
                  <span
                    className={`matched-segments__delta ${
                      diff < 0
                        ? 'matched-segments__delta--fast'
                        : diff > 0
                          ? 'matched-segments__delta--slow'
                          : 'matched-segments__delta--even'
                    }`}
                  >
                    {diff === 0 ? '持平最好' : `${formatDelta(diff)} vs 最好`}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default ActivityMatchedSegments
