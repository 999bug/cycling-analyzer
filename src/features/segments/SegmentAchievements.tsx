/**
 * 赛段成就摘要（赛段重设计二期）。
 *
 * 单机版裁剪 Strava 成就体系为三档，全部由成绩数据直接推导：
 * - 赛段纪录：握有个人最好成绩的赛段数（有成绩的赛段数）；
 * - 个人前三：进入各赛段前三的成绩数（金银铜合计）；
 * - 当地传奇：近 90 天完成次数最多的赛段（坚持型成就，无需最快）。
 *
 * 本地源消费 segment_efforts 派生的成绩榜，作者源消费 CI 预计算榜单，
 * 两者同为「赛段 id → 成绩列表」结构，计算逻辑共用。
 */
import { useMemo } from 'react'
import type { SegmentEffort } from '@/features/segments/segmentMatching'
import { computeSegmentAchievements } from '@/features/segments/segmentStats'
import './segmentAchievements.css'

/**
 * 成就摘要 props。
 */
export interface SegmentAchievementsProps {
  /** 成绩榜（key = 赛段 id；与赛段页同一份数据，null = 计算中） */
  leaderboards: ReadonlyMap<number, SegmentEffort[]> | null
}

/**
 * 赛段成就摘要。
 *
 * @param props 组件参数
 */
function SegmentAchievements({ leaderboards }: SegmentAchievementsProps) {
  const achievements = useMemo(
    () => (leaderboards !== null ? computeSegmentAchievements(leaderboards) : null),
    [leaderboards],
  )
  if (achievements === null || achievements.recordSegments === 0) {
    return null
  }
  return (
    <section className="segment-achievements" aria-label="我的赛段成就">
      <div className="segment-achievements__card">
        <div className="segment-achievements__value segment-achievements__value--gold num">
          {achievements.recordSegments}
        </div>
        <div className="segment-achievements__label">赛段纪录（握有个人最好）</div>
      </div>
      <div className="segment-achievements__card">
        <div className="segment-achievements__value num">{achievements.podiumEfforts}</div>
        <div className="segment-achievements__label">个人前三成绩</div>
      </div>
      <div className="segment-achievements__card">
        {achievements.legend !== null ? (
          <>
            <div className="segment-achievements__value num">
              {achievements.legend.count}
              <span className="segment-achievements__unit"> 次</span>
            </div>
            <div className="segment-achievements__label">
              当地传奇 · 近 90 天完成最多
              {achievements.legend.count >= 10 && (
                <span className="segment-achievements__legend-badge">传奇</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="segment-achievements__value num">—</div>
            <div className="segment-achievements__label">当地传奇 · 近 90 天完成最多</div>
          </>
        )}
      </div>
    </section>
  )
}

export default SegmentAchievements
