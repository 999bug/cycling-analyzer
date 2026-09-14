/**
 * 赛段卡片墙（赛段重设计一期升级版）。
 *
 * 每张卡片展示赛段名称（链接详情页）、关键统计（个人最好/参与次数/最近一次差值）
 * 与成绩排行前 10（排名/日期/用时/详情链接），超过 10 条收进赛段详情页；
 * 附删除按钮；成绩扫描期间显示计算中文案。
 */
import { Link } from 'react-router-dom'
import type { SegmentEntity } from '@/storage/db'
import { LazySegmentMap } from './LazySegmentMap'
import { SegmentMiniMap } from './SegmentMiniMap'
import type { SegmentEffort } from '@/features/segments/segmentMatching'
import { formatDate, formatDuration } from '@/utils/format'
import '@/features/segments/segmentCards.css'

/** 排行榜卡片内最多展示条数（完整榜单收进 /segments/:id 详情页） */
const MAX_LEADERBOARD_ROWS = 10

/**
 * 赛段卡片墙 props。
 */
export interface SegmentCardsProps {
  /** 赛段列表 */
  segments: readonly SegmentEntity[]

  /** 各赛段成绩榜（key = 赛段 id；null = 计算中） */
  leaderboards: ReadonlyMap<number, SegmentEffort[]> | null

  /** 成绩扫描是否失败 */
  failed?: boolean

  /** 删除回调（作者模式只读，不传则隐藏删除按钮） */
  onDelete?: (id: number) => void

  /** 瓦片源索引（0 = OSM，1 = 高德降级） */
  sourceIndex?: number

  /** 瓦片降级回调（OSM 连续失败后切高德并记忆） */
  onMapFallback?: () => void
}

/**
 * 差值文案：与个人最好的差值（正 = 慢，负 = 快，0 = 最新即最好）。
 *
 * @param diffSeconds 差值（秒）
 */
function formatDelta(diffSeconds: number): string {
  if (diffSeconds === 0) {
    return '最新即最好'
  }
  const sign = diffSeconds >= 0 ? '+' : '-'
  return `${sign}${Math.round(Math.abs(diffSeconds))}s vs 最好`
}

/**
 * 赛段卡片墙。
 *
 * @param props 组件参数
 */
function SegmentCards({ segments, leaderboards, failed = false, onDelete, sourceIndex = 0, onMapFallback }: SegmentCardsProps) {
  return (
    <div className="segment-cards">
      {segments.map((segment) => {
        const id = segment.id ?? 0
        const leaderboard = leaderboards?.get(id)
        const sorted = [...(leaderboard ?? [])].sort((a, b) => a.durationSeconds - b.durationSeconds)
        const pr = sorted[0]
        const latest = [...sorted].sort((a, b) => b.startTime.localeCompare(a.startTime))[0]
        const latestDelta =
          latest !== undefined && pr !== undefined
            ? latest.durationSeconds - pr.durationSeconds
            : undefined
        return (
          <div key={id} className="segment-card">
            <LazySegmentMap placeholderLabel={`${segment.name}迷你地图占位`}>
              <SegmentMiniMap
                trackPoints={segment.trackPoints}
                startLatitude={segment.startLatitude}
                startLongitude={segment.startLongitude}
                endLatitude={segment.endLatitude}
                endLongitude={segment.endLongitude}
                sourceIndex={sourceIndex}
                onFallback={onMapFallback}
              />
            </LazySegmentMap>
            <div className="segment-card__header">
              {id > 0 ? (
                <Link className="segment-card__name-link" to={`/segments/${id}`}>
                  <span className="segment-card__name">{segment.name}</span>
                </Link>
              ) : (
                <span className="segment-card__name">{segment.name}</span>
              )}
              {onDelete !== undefined && (
                <button
                  type="button"
                  className="segment-card__delete"
                  aria-label={`删除赛段 ${segment.name}`}
                  onClick={() => onDelete(id)}
                >
                  删除
                </button>
              )}
            </div>
            {failed ? (
              <p className="segment-card__hint">成绩计算失败</p>
            ) : leaderboards === null ? (
              <p className="segment-card__hint">成绩计算中…</p>
            ) : (
              <>
                <div className="segment-card__stats">
                  <div className="segment-card__stat">
                    <span className="segment-card__stat-label">个人最好</span>
                    <span className="segment-card__stat-value segment-card__stat-value--pr">
                      {pr !== undefined ? formatDuration(pr.durationSeconds) : '—'}
                    </span>
                  </div>
                  <div className="segment-card__stat">
                    <span className="segment-card__stat-label">参与次数</span>
                    <span className="segment-card__stat-value">{sorted.length} 次</span>
                  </div>
                  <div className="segment-card__stat">
                    <span className="segment-card__stat-label">
                      最近{latest !== undefined ? `（${formatDate(latest.startTime)}）` : ''}
                    </span>
                    <span className="segment-card__stat-value">
                      {latest !== undefined && latestDelta !== undefined
                        ? formatDelta(latestDelta)
                        : '—'}
                    </span>
                  </div>
                </div>
                {sorted.length > 0 ? (
                  <>
                    <ol className="segment-card__leaderboard" aria-label={`${segment.name}成绩排行`}>
                      {sorted.slice(0, MAX_LEADERBOARD_ROWS).map((effort, index) => {
                        const rank = index + 1
                        return (
                          <li key={effort.activityId} className="segment-card__row">
                            <span className="segment-card__rank">{rank}</span>
                            <Link
                              className="segment-card__effort"
                              to={`/activities/${effort.activityId}`}
                            >
                              <span className="segment-card__date">{formatDate(effort.startTime)}</span>
                              <span className="segment-card__duration">
                                {formatDuration(effort.durationSeconds)}
                              </span>
                            </Link>
                          </li>
                        )
                      })}
                    </ol>
                    {sorted.length > MAX_LEADERBOARD_ROWS && (
                      <p className="segment-card__more">
                        <Link to={`/segments/${id}`}>查看全部 {sorted.length} 次成绩 →</Link>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="segment-card__hint">暂无穿越记录</p>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default SegmentCards
