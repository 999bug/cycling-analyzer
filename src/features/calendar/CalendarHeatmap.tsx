/**
 * 骑行日历热力组件（规格 §29）。
 *
 * GitHub Contribution Graph 风格横排布局：每周一列（周日起始）、每天一行，
 * 月份标签对齐每月 1 日所在列，星期标签隔行显示（一/三/五），
 * 颜色按当日总距离分 5 档；鼠标移入格子显示原生 title 聚合详情，
 * 点击有骑行的格子通过 onDaySelect 上报日期（页面展示当日活动面板）。
 * 年份切换为受控模式（页面持有年份状态）。
 */
import type { DistanceUnit } from '@/features/settings/settings'
import type { CalendarData } from './calendarData'
import {
  buildMonthLabels,
  buildYearGrid,
  formatDayTooltip,
  intensityLevel,
  localDateKey,
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

  /** 年份切换回调（上一年/下一年/回到今年） */
  onYearChange: (year: number) => void

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit

  /** 点击有骑行格子的回调（页面展示当日活动面板） */
  onDaySelect?: (dateKey: string) => void

  /** 当前选中日期键（选中态高亮，可选） */
  selectedDate?: string | null
}

/** 图例展示档位（少 → 多） */
const LEGEND_LEVELS: IntensityLevel[] = [0, 1, 2, 3, 4]

/** 星期标签（周日起始；奇数行显示文字，偶数行留空对齐 GitHub 风格） */
const WEEKDAY_LABELS = ['', '一', '', '三', '', '五', '']

/**
 * 日历热力组件。
 */
function CalendarHeatmap({
  data,
  year,
  onYearChange,
  distanceUnit = 'km',
  onDaySelect,
  selectedDate = null,
}: CalendarHeatmapProps) {
  const grid = buildYearGrid(year, data)
  const monthLabels = buildMonthLabels(grid)
  const todayKey = localDateKey(new Date())
  const currentYear = new Date().getFullYear()

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
        {year !== currentYear && (
          <button
            type="button"
            className="calendar-heatmap__today"
            onClick={() => onYearChange(currentYear)}
          >
            回到今年
          </button>
        )}
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

      <div className="calendar-heatmap__scroller">
        <div
          className="calendar-heatmap__months"
          style={{ gridTemplateColumns: `repeat(${grid.length}, var(--cal-cell))` }}
        >
          {monthLabels.map((month) => (
            <span
              key={`${month.weekIndex}-${month.label}`}
              className="calendar-heatmap__month-label"
              style={{ gridColumnStart: month.weekIndex + 1 }}
            >
              {month.label}
            </span>
          ))}
        </div>
        <div className="calendar-heatmap__body">
          <div aria-hidden="true" className="calendar-heatmap__weekdays">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={index} className="calendar-heatmap__weekday">
                {label}
              </span>
            ))}
          </div>
          <div className="calendar-heatmap__grid">
            {grid.flat().map((cell) => {
              const level = cell.summary === null ? 0 : intensityLevel(cell.summary.distance)
              const clickable = cell.summary !== null && onDaySelect !== undefined
              const className = [
                'calendar-heatmap__cell',
                `calendar-heatmap__cell--level-${level}`,
                cell.inYear ? '' : 'calendar-heatmap__cell--outside',
                cell.dateKey === todayKey ? 'calendar-heatmap__cell--today' : '',
                cell.dateKey === selectedDate ? 'calendar-heatmap__cell--selected' : '',
                clickable ? 'calendar-heatmap__cell--clickable' : '',
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
                      : // 可点击的格子追加操作提示（静态无暗示的补足，评审 §6.3 问题 5）
                        formatDayTooltip(cell.dateKey, cell.summary, distanceUnit) +
                        (clickable ? '（点击查看当日骑行）' : '')
                  }
                  {...(clickable
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `查看 ${cell.dateKey} 骑行`,
                        onClick: () => onDaySelect(cell.dateKey),
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onDaySelect(cell.dateKey)
                          }
                        },
                      }
                    : {})}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CalendarHeatmap
