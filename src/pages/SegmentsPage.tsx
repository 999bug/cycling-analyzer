/**
 * 赛段页面（后续工作项：完整 Segment）。
 *
 * 展示用户创建的全部赛段：扫描所有活动轨迹做穿越匹配，
 * 卡片展示参与次数/最佳成绩（链接最快骑行详情）。
 * 空态引导用户去骑行详情页「设为赛段」创建。
 */
import { useCallback, useEffect, useState } from 'react'
import { db, type SegmentEffortEntity, type SegmentEntity } from '@/storage/db'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import SegmentCards from '@/features/segments/SegmentCards'
import SegmentAchievements from '@/features/segments/SegmentAchievements'
import SegmentRecommendations from '@/features/segments/SegmentRecommendations'
import {
  type SegmentActivityInput,
  type SegmentEffort,
  SUSPICIOUS_RIDE_SEGMENT_SECONDS,
} from '@/features/segments/segmentMatching'
import { computeLeaderboardsSync, createLeaderboardRunner } from '@/features/segments/leaderboardClient'
import {
  buildSegmentScanState,
  diffSegmentScanState,
  loadSegmentScanState,
  saveSegmentScanState,
} from '@/storage/segmentScanState'
import { useImportStore } from '@/stores/importStore'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { loadStoredSourceIndex, storeSourceIndex } from '@/map/tileSources'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import { downloadAuthorSegments } from '@/features/segments/authorSegmentsExport'
import {
  fetchExploreSegments,
  fetchStarredSegments,
  filterNewGpxSegments,
  parseSegmentGpx,
  filterNewSegments,
  mapStravaSegment,
  trackBounds,
} from '@/features/segments/stravaSegments'
import { listCyclingSummaries } from '@/features/activity/cyclingScope'
import '@/pages/SegmentsPage.css'

/** 赛段仓库单例 */
const segmentRepository = new DexieSegmentRepository(db)

/**
 * 落库成绩转展示用成绩榜（实体 → 领域对象，剔除落库字段）。
 *
 * @param segments 当前赛段列表（决定 Map 的键，无成绩也占位空数组）
 * @param stored 落库成绩（赛段 id → 实体列表）
 * @returns 赛段 id → 成绩榜
 */
function toBoards(
  segments: readonly SegmentEntity[],
  stored: ReadonlyMap<number, SegmentEffortEntity[]>,
): Map<number, SegmentEffort[]> {
  const boards = new Map<number, SegmentEffort[]>()
  for (const segment of segments) {
    const id = segment.id ?? 0
    boards.set(
      id,
      (stored.get(id) ?? []).map((effort) => ({
        activityId: effort.activityId,
        startTime: effort.startTime,
        durationSeconds: effort.durationSeconds,
        avgSpeed: effort.avgSpeed,
        avgPower: effort.avgPower,
        avgHeartRate: effort.avgHeartRate,
      })),
    )
  }
  return boards
}

/** Strava 导入状态：idle / importing / done / error */
type ImportState = 'idle' | 'importing' | 'done' | 'error'

/** 旧版本持久化 Token 的 localStorage key，仅用于一次性清理历史遗留值。 */
const LEGACY_STRAVA_TOKEN_KEY = 'strava-access-token'

/** 加载状态：loading / ready / error */
type LoadState = 'loading' | 'ready' | 'error'

/**
 * 赛段页面。
 */
function SegmentsPage() {
  useEffect(() => {
    // 2.51.3 起不再写入 Token；清理老版本留下的凭证，避免继续长期驻留。
    localStorage.removeItem(LEGACY_STRAVA_TOKEN_KEY)
  }, [])

  const [segments, setSegments] = useState<SegmentEntity[] | null>(null)
  const [leaderboards, setLeaderboards] = useState<ReadonlyMap<number, SegmentEffort[]> | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  // 后台增量补扫中（页面已可读，仅提示成绩正在刷新）
  const [refreshing, setRefreshing] = useState(false)
  // 订阅导入结果：导入新活动后重算成绩（规格 §8）
  const importSummary = useImportStore((s) => s.summary)
  // 当前数据源的活动仓库（源切换 → 实例变化 → 重新加载）
  const activityRepository = useActivityRepository()
  // 当前数据源（作者源赛段与成绩榜为 CI 预计算产物，分支见下）
  const source = useDataSourceStore(selectEffectiveSource)

  const reload = useCallback(() => {
    let cancelled = false

    /**
     * 后台增量补扫成绩：先与持久化的上次扫描状态 diff，
     * 无变化（最常见的重复进入场景）直接返回，不拉任何逐点数据；
     * 只有新增赛段才全量扫，仅活动增删/纠偏时只扫变化的那些活动。
     *
     * @param allSegments 当前赛段列表
     * @param previous 已读取的上次扫描状态（null = 从未扫描过）
     */
    const refreshBoards = async (
      allSegments: readonly SegmentEntity[],
      previous: Awaited<ReturnType<typeof loadSegmentScanState>>,
    ): Promise<void> => {
      const summaries = await listCyclingSummaries(activityRepository)
      const state = buildSegmentScanState(allSegments, summaries)
      const diff = diffSegmentScanState(previous, state)
      if (cancelled || !diff.needsScan) {
        return
      }
      setRefreshing(true)
      try {
        const targetIds = new Set(diff.activityIds)
        const targets = summaries.filter((summary) => targetIds.has(summary.id))
        const summaryById = new Map(targets.map((summary) => [summary.id, summary]))

        // 成绩榜在 Web Worker 批量计算（避免 N 赛段 × N 记录的结构化
        // 克隆风暴，200 活动×8000 点×N 赛段会让页面卡数十秒）；
        // jsdom/无 Worker 环境回退主线程同步纯函数；cancelled 时 terminate 终止
        const runner = createLeaderboardRunner() ?? {
          compute: async (request) => computeLeaderboardsSync(request),
          cancel: () => {},
        }
        try {
          // 只取本次需要重扫的活动的逐点数据（增量场景下通常只有新导入的几条）。
          // 分批流式：一次只把一批活动交给 Worker，峰值从「全部活动逐点」降到单批量级。
          // 落库按批提交是安全的——mergeEffortsForActivities 以传入的 activityIds 为
          // 作用边界（删该范围内旧成绩 + 写新成绩），各批的活动集互不相交
          await activityRepository.iterateRecordBatches(
            targets.map((summary) => summary.id),
            async (batch) => {
              if (cancelled) {
                return false
              }
              const batchIds: string[] = []
              const inputs: SegmentActivityInput[] = []
              for (const [activityId, records] of batch) {
                const summary = summaryById.get(activityId)
                if (summary === undefined) {
                  continue
                }
                batchIds.push(activityId)
                inputs.push({ activityId, startTime: summary.startTime, records })
              }
              const boardsBySegment = await runner.compute({
                segments: allSegments,
                inputs,
              })
              // 成绩落库（v6）：扫描结果合并进 segment_efforts（含均速/功率/心率指标），
              // 详情页「本次赛段」与赛段详情页免重扫直接读库；失败不影响本次展示
              await Promise.all(
                allSegments.map((segment) => {
                  const id = segment.id ?? 0
                  return segmentRepository
                    .mergeEffortsForActivities(id, batchIds, boardsBySegment.get(segment) ?? [])
                    .catch((error: unknown) => {
                      console.error('Failed to persist segment efforts', id, error)
                    })
                }),
              )
            },
          )
          if (cancelled) {
            return
          }
          await saveSegmentScanState(state)
          // 增量扫描只算变化的活动：榜单要合并落库里未涉及活动的旧成绩，
          // 直接读回库即为合并结果（也保证与库内数据一致）
          const persisted = await segmentRepository.listEffortsBySegments(
            allSegments.map((segment) => segment.id ?? 0),
          )
          if (cancelled) {
            return
          }
          setLeaderboards(toBoards(allSegments, persisted))
        } finally {
          runner.cancel()
        }
      } finally {
        if (!cancelled) {
          setRefreshing(false)
        }
      }
    }

    void (async () => {
      try {
        if (source === 'author') {
          // 作者源：赛段定义与成绩榜均为 CI 预计算产物（免全量逐点下载）。
          // 快照缺这两个文件时回退空列表空榜（显示空态）——这是预期分支：
          // 构建脚本在没有赛段定义时会打印明确告警（见 buildAuthorData.ts 的
          // writeSegments），此处不再重复记错误日志，否则每次进页面都落一条
          // 「无赛段」记录，反而把有效错误淹没掉
          const [authorSegments, results] = await Promise.all([
            defaultSnapshotClient.getSegments().catch(() => [] as SegmentEntity[]),
            defaultSnapshotClient.getSegmentResults().catch(() => ({}) as Record<string, SegmentEffort[]>),
          ])
          if (cancelled) {
            return
          }
          const boards = new Map<number, SegmentEffort[]>()
          for (const [key, efforts] of Object.entries(results)) {
            boards.set(Number(key), efforts)
          }
          setSegments(authorSegments)
          setLeaderboards(boards)
          setState('ready')
          return
        }

        const allSegments = await segmentRepository.listSegments()
        if (cancelled) {
          return
        }
        setSegments(allSegments)
        if (allSegments.length === 0) {
          setLeaderboards(new Map())
          setState('ready')
          return
        }

        // ① 进入即出内容：直接读落库成绩（上次扫描的产物）渲染，
        // 不再等全量逐点重扫——此前每次进入都要重扫全部活动，是卡顿主因
        const [previous, stored] = await Promise.all([
          loadSegmentScanState(),
          segmentRepository.listEffortsBySegments(allSegments.map((segment) => segment.id ?? 0)),
        ])
        if (cancelled) {
          return
        }
        const boards = toBoards(allSegments, stored)
        // 从未扫描过且落库无成绩（首次进入）→ 保留「成绩计算中…」，
        // 避免先闪一帧空的成绩榜；扫过之后一律直出落库成绩
        const hasCachedData =
          previous !== null || [...boards.values()].some((list) => list.length > 0)
        if (hasCachedData) {
          setLeaderboards(boards)
        }
        setState('ready')

        // ② 后台按数据变化增量补扫（多数情况无变化，什么都不做）
        await refreshBoards(allSegments, previous)
      } catch (error: unknown) {
        if (!cancelled) {
          setState('error')
        }
        console.error('Failed to load segments', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activityRepository, source])

  useEffect(() => {
    const cancel = reload()
    return cancel
  }, [reload, importSummary])

  // ---- Strava 赛段导入状态（仅本地模式展示） ----
  // Token 仅保存在当前页面内存，刷新后需要重新粘贴，避免凭证长期落在 localStorage。
  const [stravaToken, setStravaToken] = useState('')
  const [importState, setImportState] = useState<ImportState>('idle')
  const [importMessage, setImportMessage] = useState('')
  const [summaries, setSummaries] = useState<{ id: string; name: string }[]>([])
  const [exploreActivityId, setExploreActivityId] = useState('')
  // 瓦片源：默认高德，降级 OSM 后记忆（与热力图页共用 sessionStorage key）
  const [mapSourceIndex, setMapSourceIndex] = useState(() => loadStoredSourceIndex())

  // 本地模式加载活动下拉（最近 20 条，倒序）
  useEffect(() => {
    if (source !== 'local') {
      return
    }
    let cancelled = false
    void listCyclingSummaries(activityRepository)
      .then((all) => {
        if (cancelled) {
          return
        }
        const items = all
          .slice()
          .sort((a, b) => b.startTime.localeCompare(a.startTime))
          .slice(0, 20)
          .map((s) => ({ id: s.id, name: s.name || s.fileName }))
        setSummaries(items)
      })
      .catch((error: unknown) => {
        console.error('Failed to load summaries for explore', error)
      })
    return () => {
      cancelled = true
    }
  }, [activityRepository, source])

  /**
   * 导入 Strava 收藏赛段：分页拉取 → 映射 → 按 stravaId 去重入库。
   */
  async function handleImportStarred() {
    if (!stravaToken.trim()) {
      setImportState('error')
      setImportMessage('请先粘贴 Strava Access Token。')
      return
    }
    setImportState('importing')
    setImportMessage('')
    try {
      const existing = await segmentRepository.listSegments()
      const starred = await fetchStarredSegments(stravaToken.trim())
      const mapped = starred
        .map((s) => mapStravaSegment(s))
        .filter((s): s is NonNullable<typeof s> => s !== null)
      const fresh = filterNewSegments(existing, mapped)
      for (const segment of fresh) {
        await segmentRepository.addSegment(segment)
      }
      setImportState('done')
      setImportMessage(`导入完成：新增 ${fresh.length} 个（拉到 ${mapped.length} 个，其余已存在或缺坐标）。`)
      reload()
    } catch (error: unknown) {
      console.error('Failed to import Strava segments', error)
      setImportState('error')
      setImportMessage(error instanceof Error && error.message.includes('401')
        ? 'Strava Token 无效或已过期（401），请重新获取后粘贴。'
        : 'Strava 导入失败，请检查网络与 Token 后重试。')
    }
  }

  /**
   * 按选中活动的轨迹范围探索周边赛段并去重入库。
   */
  async function handleExplore() {
    if (!exploreActivityId) {
      return
    }
    setImportState('importing')
    setImportMessage('')
    try {
      const records = await activityRepository.getRecords(exploreActivityId)
      const bounds = trackBounds(records)
      if (!bounds) {
        setImportState('error')
        setImportMessage('该活动没有 GPS 数据，无法探索周边赛段。')
        return
      }
      const existing = await segmentRepository.listSegments()
      const explored = await fetchExploreSegments(stravaToken.trim(), bounds)
      const mapped = explored
        .map((s) => mapStravaSegment(s))
        .filter((s): s is NonNullable<typeof s> => s !== null)
      const fresh = filterNewSegments(existing, mapped)
      for (const segment of fresh) {
        await segmentRepository.addSegment(segment)
      }
      setImportState('done')
      setImportMessage(`探索完成：新增 ${fresh.length} 个（发现 ${mapped.length} 个，其余已存在或缺坐标）。`)
      reload()
    } catch (error: unknown) {
      console.error('Failed to explore Strava segments', error)
      setImportState('error')
      setImportMessage(error instanceof Error && error.message.includes('401')
        ? 'Strava Token 无效或已过期（401），请重新获取后粘贴。'
        : '探索失败，请检查网络与 Token 后重试。')
    }
  }

  /**
   * 导入 Strava 导出的赛段 GPX 文件（免费路径，无需 API 应用）：
   * 浏览器解析轨迹首末点为起终点圆，按「名称+起终点坐标」去重入库。
   *
   * @param files 用户选择的 .gpx 文件列表
   */
  async function handleImportGpx(files: FileList) {
    if (files.length === 0) {
      return
    }
    setImportState('importing')
    setImportMessage('')
    try {
      // 元素带 durationSeconds（疑似完整骑行提示用），入库前剔除
      const parsed: (Omit<SegmentEntity, 'id'> & { durationSeconds?: number })[] = []
      let invalidCount = 0
      // 疑似完整骑行名单（时长超阈值的 GPX）：建段可成功但无法有效匹配成绩
      const longRideNames: string[] = []
      for (const file of Array.from(files)) {
        try {
          const segment = parseSegmentGpx(await file.text(), file.name)
          if (segment === null) {
            invalidCount += 1
          } else {
            if (
              segment.durationSeconds !== undefined &&
              segment.durationSeconds > SUSPICIOUS_RIDE_SEGMENT_SECONDS
            ) {
              longRideNames.push(file.name)
            }
            parsed.push(segment)
          }
        } catch (error: unknown) {
          console.error('Failed to parse GPX file', file.name, error)
          invalidCount += 1
        }
      }
      const existing = await segmentRepository.listSegments()
      // existing（SegmentEntity）无 durationSeconds 字段，泛型参数统一为带可选字段的形状
      type ParsedSegment = SegmentEntity & { durationSeconds?: number }
      const fresh = filterNewGpxSegments<ParsedSegment>(
        existing,
        parsed as ParsedSegment[],
      )
      for (const segment of fresh) {
        // durationSeconds 仅用于导入提示，不落库（SegmentEntity 无此字段）
        const { durationSeconds: _ignored, ...entity } = segment
        void _ignored
        await segmentRepository.addSegment(entity)
      }
      const skipped = invalidCount + (parsed.length - fresh.length)
      setImportState(fresh.length > 0 ? 'done' : 'error')
      setImportMessage(
        `导入 ${files.length} 个 GPX 文件：新增 ${fresh.length} 个` +
        (skipped > 0 ? `（跳过 ${skipped} 个无效或重复）。` : '。') +
        (longRideNames.length > 0
          ? `⚠️ 以下文件疑似完整骑行而非赛段（时长超 2 小时），可能无法匹配成绩，建议改为从活动详情页截取设段：${longRideNames.join('、')}`
          : ''),
      )
      reload()
    } catch (error: unknown) {
      console.error('Failed to import GPX segments', error)
      setImportState('error')
      setImportMessage('GPX 导入失败，请重试。')
    }
  }
  /**
   * 删除赛段后重新加载列表与成绩。
   *
   * @param id 赛段 id
   */
  function handleDelete(id: number) {
    segmentRepository
      .deleteSegment(id)
      .then(() => reload())
      .catch((error: unknown) => {
        console.error('Failed to delete segment', error)
      })
  }

  return (
    <>
      <h1>赛段</h1>
      {refreshing && <p className="segments-page__refreshing">成绩更新中…</p>}
      {source === 'local' && (
        <details className="segments-page__strava">
          <summary>从 Strava 导入赛段</summary>
          <div className="segments-page__strava-body">
            <label className="segments-page__strava-row">
              <span>Access Token</span>
              <input
                type="password"
                value={stravaToken}
                onChange={(e) => setStravaToken(e.target.value)}
                placeholder="粘贴 Strava Access Token（6 小时过期）"
                autoComplete="off"
              />
            </label>
            <p className="segments-page__strava-hint">
              API 方式：在 strava.com/settings/api 创建应用后获取；Token 仅在当前页面使用，刷新后需重新粘贴。
            </p>
            <p className="segments-page__strava-hint">
              没有 Strava 订阅？免费方案：打开 Strava 赛段页 → 导出 GPX → 点「导入 GPX 文件」选择下载的 .gpx（可多选），自动解析建段并匹配成绩。
            </p>
            <div className="segments-page__strava-actions">
              <button
                type="button"
                onClick={() => void handleImportStarred()}
                disabled={importState === 'importing'}
              >
                导入收藏赛段
              </button>
              <select
                value={exploreActivityId}
                onChange={(e) => setExploreActivityId(e.target.value)}
                aria-label="选择活动用于探索周边赛段"
              >
                <option value="">按活动探索周边赛段…</option>
                {summaries.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleExplore()}
                disabled={importState === 'importing' || exploreActivityId === ''}
              >
                探索周边赛段
              </button>

              <label className="segments-page__gpx-label">
                <input
                  type="file"
                  accept=".gpx"
                  multiple
                  aria-label="导入 Strava 赛段 GPX 文件"
                  disabled={importState === 'importing'}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      void handleImportGpx(e.target.files)
                    }
                    // 允许重复选择同一文件再次导入（去重由 filterNewGpxSegments 保证）
                    e.target.value = ''
                  }}
                />
                导入 GPX 文件
              </label>
            </div>
            {importMessage !== '' && (
              <p className={`segments-page__strava-message segments-page__strava-message--${importState}`}>
                {importMessage}
              </p>
            )}
          </div>
        </details>
      )}
      {source === 'local' && (
        <div className="segments-page__toolbar">
          <button
            type="button"
            className="segments-page__export"
            onClick={() => downloadAuthorSegments(segments ?? [])}
            disabled={segments === null || segments.length === 0}
            title={segments !== null && segments.length > 0 ? '导出 author-data/segments.json（放入仓库 push 即可上线作者赛段）' : undefined}
          >
            导出作者赛段 JSON
          </button>
        </div>
      )}
      {state === 'error' && <p className="segments-page__message">加载失败，请稍后重试。</p>}
      {state === 'loading' && <p className="segments-page__message">赛段加载中…</p>}
      {state === 'ready' && segments !== null && segments.length === 0 && (
        <p className="segments-page__message">
          {source === 'author'
            ? '作者尚未创建赛段。作者可在本地数据模式创建赛段后，于赛段页导出 segments.json 提交到仓库发布。'
            : '还没有赛段。打开任意骑行详情页，点击「设为赛段」即可把该骑行的起终点创建为赛段。'}
        </p>
      )}
      {state === 'ready' && segments !== null && segments.length > 0 && (
        <>
          <SegmentAchievements leaderboards={leaderboards} />
          {source === 'local' && (
            <SegmentRecommendations
              existingSegments={segments}
              activityRepository={activityRepository}
              onCreated={reload}
            />
          )}
          <SegmentCards
            segments={segments}
            leaderboards={leaderboards}
            onDelete={source === 'local' ? handleDelete : undefined}
            sourceIndex={mapSourceIndex}
            onMapFallback={() => {
              setMapSourceIndex(1)
              storeSourceIndex(1)
            }}
          />
        </>
      )}
    </>
  )
}

export default SegmentsPage
