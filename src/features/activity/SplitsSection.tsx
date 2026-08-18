/**
 * 分段详情区块：按距离等长切片（默认 5km，可选 1/10/100/200km），
 * 每段展示用时、平均时速（随单位偏好 km/h / mph）与平均心率。
 * 最后不足一段按实际距离收尾；数据全部来自逐点记录（splits.ts 纯函数）。
 */
import { useMemo, useState } from 'react'
import type { ActivityRecord } from '@/types/activity'
import { buildSplits } from '@/features/activity/splits'
import { formatDuration } from '@/utils/format'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'
import '@/features/activity/splitsSection.css'

/** 可选段长（米） */
const SPLIT_LENGTH_OPTIONS: ReadonlyArray<{ meters: number; label: string }> = [
  { meters: 1000, label: '1 公里' },
  { meters: 5000, label: '5 公里' },
  { meters: 10000, label: '10 公里' },
  { meters: 100000, label: '100 公里' },
  { meters: 200000, label: '200 公里' },
]

/** 默认段长（5 公里） */
const DEFAULT_SPLIT_LENGTH_METERS = 5000

/**
 * 分段详情区块 props。
 */
export interface SplitsSectionProps {
  /** 逐点记录（完整数据，不抽稀） */
  records: ActivityRecord[]

  /** 距离显示单位（距离/时速随偏好换算） */
  distanceUnit: DistanceUnit
}

/**
 * 分段详情区块。
 *
 * @param props 组件参数
 */
function SplitsSection({ records, distanceUnit }: SplitsSectionProps) {
  const [splitLength, setSplitLength] = useState(DEFAULT_SPLIT_LENGTH_METERS)

  // 分段计算：records/段长变化时重算（records ≤ 万级，纯函数开销可忽略）
  const splits = useMemo(() => buildSplits(records, splitLength), [records, splitLength])

  if (splits.length === 0) {
    return null
  }

  return (
    <section className="splits-section" aria-label="分段详情">
      <div className="splits-section__header">
        <h2 className="splits-section__title">分段详情</h2>
        <div className="splits-section__toggle" role="group" aria-label="分段距离">
          {SPLIT_LENGTH_OPTIONS.map((option) => (
            <button
              key={option.meters}
              type="button"
              className={
                splitLength === option.meters
                  ? 'splits-section__toggle-btn splits-section__toggle-btn--active'
                  : 'splits-section__toggle-btn'
              }
              aria-pressed={splitLength === option.meters}
              onClick={() => setSplitLength(option.meters)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="splits-section__scroller">
        <table className="splits-table">
          <thead>
            <tr>
              <th>段</th>
              <th>距离</th>
              <th>用时</th>
              <th>时速</th>
              <th>平均心率</th>
            </tr>
          </thead>
          <tbody>
            {splits.map((split) => (
              <tr key={split.index}>
                <td>{split.index}</td>
                <td>{formatDistanceByUnit(split.endDistance - split.startDistance, distanceUnit)}</td>
                <td>{formatDuration(split.duration)}</td>
                <td>{formatSpeedByUnit(split.avgSpeed, distanceUnit)}</td>
                <td>{split.avgHeartRate === undefined ? '—' : `${Math.round(split.avgHeartRate)} bpm`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default SplitsSection
