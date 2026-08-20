/**
 * 骑行质量评分区块：综合评分（大数字）+ 各分项得分条 + 总体评价文案。
 * 数据来自逐点记录（qualityScore.ts 纯函数），缺失分项不展示（不伪造评分）；
 * 无任何分项数据时不渲染。
 */
import { useMemo } from 'react'
import { computeQualityScore } from '@/features/analysis/qualityScore'
import type { ActivityRecord } from '@/types/activity'
import '@/features/analysis/qualityScoreSection.css'

/** 分项得分条配色（稳定类 = 主色；爬坡/后程 = 强调色，区分维度） */
const SCORE_BAR_COLORS: Record<string, string> = {
  paceStability: 'var(--primary)',
  heartRateControl: '#22c55e',
  powerStability: 'var(--primary)',
  climbPerformance: '#f97316',
  endurance: '#a855f7',
}

/**
 * 骑行质量评分区块 props。
 */
export interface QualityScoreSectionProps {
  /** 逐点记录（含速度/功率/心率/距离） */
  records: ActivityRecord[]
}

/**
 * 骑行质量评分区块组件。
 *
 * @param props 组件参数
 */
function QualityScoreSection({ records }: QualityScoreSectionProps) {
  // 评分计算：records 变化时重算（纯函数）
  const score = useMemo(() => computeQualityScore(records), [records])

  // 有得分的分项（缺失数据的不渲染，避免误导）
  const available = score.subScores.filter((item) => item.score !== undefined)

  if (available.length === 0 || score.overall === undefined) {
    return null
  }

  return (
    <section className="quality-section" aria-label="骑行质量评分">
      <div className="quality-section__header">
        <div className="quality-section__overall">
          <span className="quality-section__overall-value">{score.overall}</span>
          <span className="quality-section__overall-label">综合评分</span>
        </div>
        {score.verdict !== undefined && (
          <p className="quality-section__verdict">{score.verdict}</p>
        )}
      </div>

      <ul className="quality-section__subscores">
        {available.map((item) => (
          <li key={item.key} className="quality-subscore">
            <span className="quality-subscore__label">{item.label}</span>
            <div className="quality-subscore__track">
              <div
                className="quality-subscore__fill"
                style={{
                  width: `${item.score}%`,
                  backgroundColor: SCORE_BAR_COLORS[item.key] ?? 'var(--primary)',
                }}
              />
            </div>
            <span className="quality-subscore__value">{item.score}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default QualityScoreSection