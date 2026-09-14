/**
 * 高频路段推荐区块（赛段重设计三期）。
 *
 * 本地挖掘「我常骑的路段」：热力网格找高频格对 → 候选段 → 用既有匹配器
 * 复核真实命中数 → 展示推荐卡片（距离 / 命中次数），可改名后一键建段，
 * 也可跳过；与既有赛段重合的候选自动过滤。
 *
 * 仅本地数据源可用（作者快照只读）；挖掘纯本地计算，匹配复核走既有
 * leaderboard runner（有 Worker 用 Worker，jsdom 回退主线程）。
 */
import { useState } from 'react'
import type { SegmentEntity } from '@/storage/db'
import { db } from '@/storage/db'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import type { ActivityReadRepository } from '@/storage/repositories/activityRepository'
import {
  DEFAULT_MINING_PARAMS,
  filterCandidatesAgainstExisting,
  mineSegmentCandidates,
  type SegmentCandidate,
} from '@/features/segments/segmentMining'
import type { SegmentGeometry } from '@/features/segments/segmentMatching'
import { computeLeaderboardsSync, createLeaderboardRunner } from '@/features/segments/leaderboardClient'
import { listCyclingSummaries } from '@/features/activity/cyclingScope'
import { buildSegmentNameRequest } from '@/features/ai/aiPrompts'
import { chatComplete } from '@/features/ai/aiClient'
import { resolveAiConfig, selectAiReady, useAiConfigStore } from '@/features/ai/aiConfigStore'
import { formatDistance } from '@/utils/format'
import './segmentRecommendations.css'

/** 默认仓库（注入点） */
const defaultRepository = new DexieSegmentRepository(db)

/** 推荐条目（候选 + 复核后的真实命中） */
interface RecommendationView extends SegmentCandidate {
  hitCount: number

  /** 首个命中活动 ID（建段 sourceActivityId 用） */
  sourceActivityId: string
}

/** 加载状态 */
type MiningState = 'idle' | 'mining' | 'ready' | 'error'

/**
 * 组件 props。
 */
export interface SegmentRecommendationsProps {
  /** 既有赛段（重合候选过滤） */
  existingSegments: readonly SegmentEntity[]

  /** 活动仓库（挖掘数据源） */
  activityRepository: ActivityReadRepository

  /** 创建成功回调（页面重新加载成绩） */
  onCreated: () => void

  /** 赛段仓库注入（测试用） */
  repository?: typeof defaultRepository
}

/**
 * 高频路段推荐区块。
 *
 * @param props 组件参数
 */
function SegmentRecommendations({
  existingSegments,
  activityRepository,
  onCreated,
  repository = defaultRepository,
}: SegmentRecommendationsProps) {
  const [state, setState] = useState<MiningState>('idle')
  const [recommendations, setRecommendations] = useState<RecommendationView[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})
  const [creatingKey, setCreatingKey] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  // AI 起名（BYOK 可选）：未配置 Key 时入口不渲染
  const aiReady = useAiConfigStore(selectAiReady)
  const [namingKey, setNamingKey] = useState<string | undefined>()

  /**
   * AI 起名：只上行候选段聚合特征（长度/共现次数），结果填入名称输入框。
   *
   * @param candidate 候选段
   * @param key 列表键
   */
  async function handleAiName(candidate: RecommendationView, key: string) {
    const config = resolveAiConfig(useAiConfigStore.getState())
    if (config === null) {
      return
    }
    setNamingKey(key)
    setError(undefined)
    try {
      const request = buildSegmentNameRequest({
        distanceKm: candidate.distanceMeters / 1000,
        hitCount: candidate.hitCount,
      })
      const name = await chatComplete(config, {
        system: request.system,
        user: request.user,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      })
      const cleaned = name
        .trim()
        .replace(/^["'「『]+|["'」』.。]+$/g, '')
        .slice(0, 20)
      if (cleaned !== '') {
        setNames((previous) => ({ ...previous, [key]: cleaned }))
      }
    } catch (err: unknown) {
      console.error('Failed to name segment with AI', err)
      setError('AI 起名失败，请稍后重试。')
    } finally {
      setNamingKey(undefined)
    }
  }

  const candidateKey = (candidate: SegmentCandidate, index: number): string =>
    `${candidate.startLatitude.toFixed(5)},${candidate.startLongitude.toFixed(5)}#${index}`

  /**
   * 运行挖掘：网格聚类 → 既有段去重 → 匹配器复核真实命中。
   */
  async function runMining() {
    setState('mining')
    setError(undefined)
    setRecommendations([])
    setDismissed(new Set())
    setNames({})
    try {
      const summaries = await listCyclingSummaries(activityRepository)
      const recordsByActivity = await activityRepository.getRecordsByActivityIds(
        summaries.map((summary) => summary.id),
      )
      const inputs = summaries.map((summary) => ({
        activityId: summary.id,
        startTime: summary.startTime,
        records: recordsByActivity.get(summary.id) ?? [],
      }))
      // 网格聚类（纯函数，主线程；采样计数开销可控）
      const candidates = filterCandidatesAgainstExisting(
        mineSegmentCandidates(inputs, DEFAULT_MINING_PARAMS),
        existingSegments,
      )
      if (candidates.length === 0) {
        setRecommendations([])
        setState('ready')
        return
      }
      // 匹配器复核真实命中数（与赛段页同一套 Worker 管线）
      const runner = createLeaderboardRunner() ?? {
        compute: computeLeaderboardsSync,
        cancel: () => {},
      }
      try {
        const boards = await runner.compute({
          segments: candidates as SegmentGeometry[],
          inputs,
        })
        const views: RecommendationView[] = candidates
          .map((candidate) => {
            const efforts = boards.get(candidate as SegmentGeometry) ?? []
            return {
              ...candidate,
              hitCount: efforts.length,
              sourceActivityId: efforts[0]?.activityId ?? '',
            }
          })
          .filter((view) => view.hitCount >= DEFAULT_MINING_PARAMS.minPairHits)
          .sort((a, b) => b.hitCount - a.hitCount)
        setRecommendations(views)
        setState('ready')
      } finally {
        runner.cancel()
      }
    } catch (err: unknown) {
      console.error('Failed to mine segment candidates', err)
      setError('分析失败，请重试。')
      setState('error')
    }
  }

  /**
   * 一键建段：轨迹切片与起终点圆来自候选，成绩由页面重扫自动落库。
   *
   * @param candidate 候选段（含复核命中的来源活动）
   * @param key 列表键
   */
  async function handleCreate(candidate: RecommendationView, key: string) {
    setCreatingKey(key)
    try {
      const name = (names[key] ?? '').trim() || `高频路段 ${key.slice(-4)}`
      // 来源活动取复核命中的首个（满足 sourceActivityId 语义；纯挖掘无来源时兜底空串）
      await repository.addSegment({
        name,
        startLatitude: candidate.startLatitude,
        startLongitude: candidate.startLongitude,
        endLatitude: candidate.endLatitude,
        endLongitude: candidate.endLongitude,
        sourceActivityId: candidate.sourceActivityId,
        createdAt: new Date().toISOString(),
        trackPoints: candidate.trackPoints,
      })
      setDismissed((previous) => new Set(previous).add(key))
      onCreated()
    } catch (err: unknown) {
      console.error('Failed to create recommended segment', err)
      setError('创建失败，请重试。')
    } finally {
      setCreatingKey(undefined)
    }
  }

  const visible = recommendations.filter(
    (candidate, index) => !dismissed.has(candidateKey(candidate, index)),
  )

  return (
    <details className="segment-recommendations" open={state !== 'idle'}>
      <summary>推荐赛段（本地挖掘高频路段）</summary>
      <div className="segment-recommendations__body">
        <p className="segment-recommendations__hint">
          分析你的历史骑行，找出反复经过的路段（0.3–1.2 km 量级、被多次穿越），一键建段开始计时。
          全程本地计算，不依赖任何在线服务。
        </p>
        <button
          type="button"
          className="segment-recommendations__run"
          onClick={() => void runMining()}
          disabled={state === 'mining'}
        >
          {state === 'mining' ? '分析中…' : state === 'idle' ? '分析我的高频路段' : '重新分析'}
        </button>
        {error !== undefined && <p className="segment-recommendations__message">{error}</p>}
        {state === 'ready' && recommendations.length === 0 && (
          <p className="segment-recommendations__message">
            没有发现符合条件的高频路段（需要同一路段被 ≥{DEFAULT_MINING_PARAMS.minPairHits} 次不同骑行经过）。
          </p>
        )}
        {state === 'ready' && visible.length > 0 && (
          <ul className="segment-recommendations__list">
            {visible.map((candidate, index) => {
              const key = candidateKey(candidate, index)
              return (
                <li key={key} className="segment-recommendations__item">
                  <div className="segment-recommendations__item-main">
                    <input
                      type="text"
                      className="segment-recommendations__name"
                      value={names[key] ?? ''}
                      placeholder={`高频路段 ${index + 1}`}
                      aria-label="赛段名称"
                      onChange={(event) =>
                        setNames((previous) => ({ ...previous, [key]: event.target.value }))
                      }
                    />
                    <span className="segment-recommendations__meta">
                      {formatDistance(candidate.distanceMeters)} · 经过 {candidate.hitCount} 次
                    </span>
                  </div>
                  <div className="segment-recommendations__item-actions">
                    {aiReady && (
                      <button
                        type="button"
                        className="segment-recommendations__skip"
                        disabled={namingKey === key}
                        onClick={() => void handleAiName(candidate, key)}
                        title="用 AI 根据路段特征起名（只上行距离与次数，不含轨迹）"
                      >
                        {namingKey === key ? '起名中…' : 'AI 起名'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="segment-recommendations__create"
                      disabled={creatingKey === key}
                      onClick={() => void handleCreate(candidate, key)}
                    >
                      {creatingKey === key ? '创建中…' : '创建赛段'}
                    </button>
                    <button
                      type="button"
                      className="segment-recommendations__skip"
                      onClick={() => setDismissed((previous) => new Set(previous).add(key))}
                    >
                      跳过
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </details>
  )
}

export default SegmentRecommendations
