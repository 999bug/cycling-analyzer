/**
 * 赛段卡片墙（后续工作项：完整 Segment）。
 *
 * 每张卡片展示赛段名称、参与次数（完整穿越的活动数）、最佳成绩与
 * 最快骑行详情链接，附删除按钮；成绩扫描期间显示计算中文案。
 */
import { Link } from 'react-router-dom'
import type { SegmentEntity } from '@/storage/db'
import type { SegmentEffort } from '@/features/segments/segmentMatching'
import { formatDuration } from '@/utils/format'
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
}

/**
 * 赛段卡片墙。
 *
 * @param props 组件参数
 */
function SegmentCards({ segments, leaderboards, failed = false, onDelete }: SegmentCardsProps) {
  return (
    <div className="segment-cards">
      {segments.map((segment) => {
        const id = segment.id ?? 0
        const leaderboard = leaderboards?.get(id)
        const best = leaderboard?.[0]
        return (
          <div key={id} className="segment-card">
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
              <div className="segment-card__stats">
                <div className="segment-card__stat">
                  <span className="segment-card__stat-label">参与次数</span>
                  <span className="segment-card__stat-value">{leaderboard?.length ?? 0} 次</span>
                </div>
                <div className="segment-card__stat">
                  <span className="segment-card__stat-label">最佳成绩</span>
                  {best === undefined ? (
                    <span className="segment-card__stat-value">—</span>
                  ) : (
                    <Link className="segment-card__best" to={`/activities/${best.activityId}`}>
                      {formatDuration(best.durationSeconds)}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default SegmentCards
