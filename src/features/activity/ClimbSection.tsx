/**
 * 爬坡分析区块：识别活动中的爬坡段（连续爬升 ≥30m 且平均坡度 ≥1.5%），
 * 表格展示距离/爬升/平均坡度/最大坡度。无爬坡时区块不渲染。
 */
import { useMemo } from 'react'
import { buildClimbs } from '@/features/activity/climbs'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { ActivityRecord } from '@/types/activity'
import '@/features/activity/ClimbSection.css'

/**
 * 爬坡分析区块 props。
 */
export interface ClimbSectionProps {
  /** 逐点记录（含海拔/距离） */
  records: ActivityRecord[]

  /** 距离显示单位（规格 §27） */
  distanceUnit: DistanceUnit
}

/**
 * 爬坡分析区块组件。
 *
 * @param props 组件参数
 */
function ClimbSection({ records, distanceUnit }: ClimbSectionProps) {
  // 爬坡段计算：records 变化时重算（纯函数，O(n)）
  const climbs = useMemo(() => buildClimbs(records), [records])

  if (climbs.length === 0) {
    return null
  }

  return (
    <section className="climb-section" aria-label="爬坡分析">
      <h2 className="climb-section__title">爬坡分析</h2>
      <p className="climb-section__summary">共 {climbs.length} 段爬坡（连续爬升 ≥ 30 米且平均坡度 ≥ 1.5%）</p>
      <div className="climb-section__scroller">
        <table className="climb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>距离</th>
              <th>爬升</th>
              <th>平均坡度</th>
              <th>最大坡度</th>
            </tr>
          </thead>
          <tbody>
            {climbs.map((climb, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>{formatDistanceByUnit(climb.distanceMeters, distanceUnit)}</td>
                <td>{Math.round(climb.elevationGain)} m</td>
                <td>{climb.avgGradePercent.toFixed(1)}%</td>
                <td>{climb.maxGradePercent.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default ClimbSection
