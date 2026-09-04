/**
 * 赛段页面（后续工作项：完整 Segment）。
 *
 * 展示用户创建的全部赛段：扫描所有活动轨迹做穿越匹配，
 * 卡片展示参与次数/最佳成绩（链接最快骑行详情）。
 * 空态引导用户去骑行详情页「设为赛段」创建。
 */
import { useCallback, useEffect, useState } from 'react'
import { db, type SegmentEntity } from '@/storage/db'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import SegmentCards from '@/features/segments/SegmentCards'
import {
  type SegmentActivityInput,
  type SegmentEffort,
  SUSPICIOUS_RIDE_SEGMENT_SECONDS,
} from '@/features/segments/segmentMatching'
import { computeLeaderboardsSync, createLeaderboardRunner } from '@/features/segments/leaderboardClient'
import { useImportStore } from '@/stores/importStore'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { loadStoredSourceIndex, storeSourceIndex } from '@/map/tileSources'
import { summariesScanKey } from '@/storage/scanCache'
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
import '@/pages/SegmentsPage.css'

/** 赛段仓库单例 */
const segmentRepository = new DexieSegmentRepository(db)

/**
 * 成绩榜模块级缓存（性能优化）：key = 活动集合指纹 + 赛段 ID 列表。
 * 赛段创建后不可变（无编辑入口），活动逐点导入后不可变，
 * 两者任一变化（导入/删除活动、增删赛段）都会改变 key 自动失效。
 */
let leaderboardCache: { key: string; boards: ReadonlyMap<number, SegmentEffort[]> } | null = null

/** localStorage key：Strava access token（6 小时过期，过期需重新粘贴） */
const STRAVA_TOKEN_KEY = 'strava-access-token'

/** Strava 导入状态：idle / importing / done / error */
type ImportState = 'idle' | 'importing' | 'done' | 'error'

/** 加载状态：loading / ready / error */
type LoadState = 'loading' | 'ready' | 'error'

/**
 * 赛段页面。
 */
function SegmentsPage() {
  const [segments, setSegments] = useState<SegmentEntity[] | null>(null)
  const [leaderboards, setLeaderboards] = useState<ReadonlyMap<number, SegmentEffort[]> | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  // 订阅导入结果：导入新活动后重算成绩（规格 §8）
  const importSummary = useImportStore((s) => s.summary)
  // 当前数据源的活动仓库（源切换 → 实例变化 → 重新加载）
  const activityRepository = useActivityRepository()
  // 当前数据源（作者源赛段与成绩榜为 CI 预计算产物，分支见下）
  const source = useDataSourceStore(selectEffectiveSource)

  const reload = useCallback(() => {
    let cancelled = false
    void (async () => {
      try {
        if (source === 'author') {
          // 作者源：赛段定义与成绩榜均为 CI 预计算产物（免全量逐点下载）；
          // 快照缺赛段文件时回退空列表空榜（显示空态）
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

        // 扫描全部活动轨迹：每个赛段独立匹配成绩榜（命中缓存跳过全量扫描）
        const summaries = await activityRepository.listAllSummaries()
        const cacheKey = `${summariesScanKey(summaries)}#${allSegments.map((segment) => segment.id ?? 0).join(',')}`
        if (leaderboardCache !== null && leaderboardCache.key === cacheKey) {
          if (!cancelled) {
            setLeaderboards(leaderboardCache.boards)
            setState('ready')
          }
          return
        }

        // 批量取活动逐点记录（一次 anyOf 索引查询替代 N 次串行 equals），
        // 代替 N+1 的 for-await getRecords 循环
        const recordsByActivity = await activityRepository.getRecordsByActivityIds(
          summaries.map((s) => s.id),
        )
        if (cancelled) {
          return
        }
        const inputs: SegmentActivityInput[] = summaries.map((summary) => ({
          activityId: summary.id,
          startTime: summary.startTime,
          records: recordsByActivity.get(summary.id) ?? [],
        }))

        // 成绩榜在 Web Worker 一次批量计算（避免 N 赛段 × N 记录的结构化
        // 克隆风暴，200 活动×8000 点×N 赛段会让页面卡数十秒）；
        // jsdom/无 Worker 环境回退主线程同步纯函数；cancelled 时 terminate 终止
        const runner = createLeaderboardRunner() ?? {
          compute: async (request) => computeLeaderboardsSync(request),
          cancel: () => {},
        }
        try {
          const boardsBySegment = await runner.compute({
            segments: allSegments,
            inputs,
          })
          if (cancelled) {
            return
          }
          // boardsBySegment 键为 SegmentGeometry 对象，转为按 id 索引的
          // 业务 Map<number, SegmentEffort[]> 以便下游 SegmentCards 消费
          const boards = new Map<number, SegmentEffort[]>()
          for (const segment of allSegments) {
            boards.set(segment.id ?? 0, boardsBySegment.get(segment) ?? [])
          }
          leaderboardCache = { key: cacheKey, boards }
          setLeaderboards(boards)
          setState('ready')
        } finally {
          runner.cancel()
        }
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
  const [stravaToken, setStravaToken] = useState(() => localStorage.getItem(STRAVA_TOKEN_KEY) ?? '')
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
    void activityRepository
      .listAllSummaries()
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
      localStorage.setItem(STRAVA_TOKEN_KEY, stravaToken.trim())
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
              API 方式：在 strava.com/settings/api 创建应用后获取；Token 过期后重新粘贴即可。
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
      )}
    </>
  )
}

export default SegmentsPage
