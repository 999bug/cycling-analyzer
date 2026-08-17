/**
 * 赛段页面（后续工作项：完整 Segment）。
 *
 * 展示用户创建的全部赛段：扫描所有活动轨迹做穿越匹配，
 * 卡片展示参与次数/最佳成绩（链接最快骑行详情）。
 * 空态引导用户去骑行详情页「设为赛段」创建。
 */
import { useCallback, useEffect, useState } from 'react'
import { db, type SegmentEntity } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import SegmentCards from '@/features/segments/SegmentCards'
import {
  buildSegmentLeaderboard,
  type SegmentActivityInput,
  type SegmentEffort,
} from '@/features/segments/segmentMatching'
import { useImportStore } from '@/stores/importStore'
import '@/pages/SegmentsPage.css'

/** 活动仓库单例（测试可 mock @/storage/db 注入独立数据库） */
const activityRepository = new DexieActivityRepository(db)

/** 赛段仓库单例 */
const segmentRepository = new DexieSegmentRepository(db)

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

  const reload = useCallback(() => {
    let cancelled = false
    void (async () => {
      try {
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

        // 扫描全部活动轨迹：每个赛段独立匹配成绩榜
        const summaries = await activityRepository.listAllSummaries()
        const inputs: SegmentActivityInput[] = []
        for (const summary of summaries) {
          const records = await activityRepository.getRecords(summary.id)
          if (cancelled) {
            return
          }
          inputs.push({ activityId: summary.id, startTime: summary.startTime, records })
        }

        const boards = new Map<number, SegmentEffort[]>()
        for (const segment of allSegments) {
          boards.set(segment.id ?? 0, buildSegmentLeaderboard(segment, inputs))
        }
        if (!cancelled) {
          setLeaderboards(boards)
          setState('ready')
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
  }, [])

  useEffect(() => {
    const cancel = reload()
    return cancel
  }, [reload, importSummary])

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
      {state === 'error' && <p className="segments-page__message">加载失败，请稍后重试。</p>}
      {state === 'loading' && <p className="segments-page__message">赛段加载中…</p>}
      {state === 'ready' && segments !== null && segments.length === 0 && (
        <p className="segments-page__message">
          还没有赛段。打开任意骑行详情页，点击「设为赛段」即可把该骑行的起终点创建为赛段。
        </p>
      )}
      {state === 'ready' && segments !== null && segments.length > 0 && (
        <SegmentCards
          segments={segments}
          leaderboards={leaderboards}
          onDelete={handleDelete}
        />
      )}
    </>
  )
}

export default SegmentsPage
