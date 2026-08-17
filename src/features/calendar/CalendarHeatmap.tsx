/**
 * 骑行日历热力组件（规格 §29）。
 *
 * GitHub Contribution Graph 风格：按年展示，每周一行（周日起始），
 * 每日一格，颜色按当日总距离分 5 档；鼠标移入格子通过原生 title
 * 提示当日聚合详情。年份切换为受控模式（页面持有年份状态）。
 */
import type { DistanceUnit } from '@/features/settings/settings'
import type { CalendarData } from './calendarData'
import {
  buildYearGrid,
  formatDayTooltip,
  intensityLevel,
  type IntensityLevel,
} from './calendarData'
import './calendar.css'

/**
 * 日历热力组件属性。
 */
export interface CalendarHeatmapProps {
  /** 聚合数据（buildCalendarData 输出） */
  data: CalendarData

  /** 当前展示年份 */
  year: number

  /** 年份切换回调（上一年/下一年） */
  onYearChange: (year: number) => void

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/** 图例展示档位（少 → 多） */
const LEGEND_LEVELS: IntensityLevel[] = [0, 1, 2, 3, 4]

/**
 * 日历热力组件。
 */
function CalendarHeatmap({ data, year, onYearChange, distanceUnit = 'km' }: CalendarHeatmapProps) {
  const grid = buildYearGrid(year, data)

  return (
    <div className="calendar-heatmap">
      <div className="calendar-heatmap__header">
        <button
          type="button"
          className="calendar-heatmap__nav"
          aria-label="上一年"
          onClick={() => onYearChange(year - 1)}
        >
          ‹
        </button>
        <span className="calendar-heatmap__year">{year}</span>
        <button
          type="button"
          className="calendar-heatmap__nav"
          aria-label="下一年"
          onClick={() => onYearChange(year + 1)}
        >
          ›
        </button>
        <div className="calendar-heatmap__legend">
          <span className="calendar-heatmap__legend-text">少</span>
          {LEGEND_LEVELS.map((level) => (
            <div
              key={level}
              className={`calendar-heatmap__cell calendar-heatmap__cell--legend calendar-heatmap__cell--level-${level}`}
            />
          ))}
          <span className="calendar-heatmap__legend-text">多</span>
        </div>
      </div>

      <div className="calendar-heatmap__grid">
        {grid.flat().map((cell) => {
          const level = cell.summary === null ? 0 : intensityLevel(cell.summary.distance)
          const className = [
            'calendar-heatmap__cell',
            `calendar-heatmap__cell--level-${level}`,
            cell.inYear ? '' : 'calendar-heatmap__cell--outside',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={cell.dateKey}
              className={className}
              data-date={cell.dateKey}
              data-level={level}
              title={
                cell.summary === null
                  ? undefined
                  : formatDayTooltip(cell.dateKey, cell.summary, distanceUnit)
              }
            />
          )
        })}
      </div>
    </div>
  )
}

export default CalendarHeatmap
