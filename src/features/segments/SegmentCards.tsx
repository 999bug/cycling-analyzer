/**
 * 赛段卡片墙（后续工作项：完整 Segment）。
 *
 * 每张卡片展示赛段名称、参与次数与完整成绩排行列表
 * （排名/日期/用时/详情链接，按用时升序 = 排名顺序），
 * 附删除按钮；成绩扫描期间显示计算中文案。
 */
import { Link } from 'react-router-dom'
import type { SegmentEntity } from '@/storage/db'
import { LazySegmentMap } from './LazySegmentMap'
import { SegmentMiniMap } from './SegmentMiniMap'
import type { SegmentEffort } from '@/features/segments/segmentMatching'
import { formatDate, formatDuration } from '@/utils/format'
import '@/features/segments/segmentCards.css'

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
              <span className="segment-card__name">{segment.name}</span>
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
                    <span className="segment-card__stat-label">参与次数</span>
                    <span className="segment-card__stat-value">{leaderboard?.length ?? 0} 次</span>
                  </div>
                </div>
                {(leaderboard?.length ?? 0) > 0 ? (
                  <ol className="segment-card__leaderboard" aria-label={`${segment.name}成绩排行`}>
                    {leaderboard!.map((effort, index) => {
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

