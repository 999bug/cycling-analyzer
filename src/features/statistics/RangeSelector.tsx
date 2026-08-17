/**
 * 统计时间范围选择器（规格 §28）。
 *
 * radio 组选择六个预设范围（本周/本月/今年/过去 12 个月/全部/自定义），
 * 选中「自定义」时显示起止日期输入（YYYY-MM-DD，含边界日）。
 */
import { RANGE_LABELS, type RangeKey } from '@/features/statistics/statistics'
import '@/features/statistics/RangeSelector.css'

/** 范围键展示顺序（与 RANGE_LABELS 定义顺序一致） */
const RANGE_KEYS: RangeKey[] = ['week', 'month', 'year', 'last12Months', 'all', 'custom']

interface RangeSelectorProps {
  /** 当前选中范围键 */
  value: RangeKey

  /** 切换范围回调 */
  onChange: (key: RangeKey) => void

  /** 自定义起始日期（YYYY-MM-DD） */
  customStart: string

  /** 自定义结束日期（YYYY-MM-DD） */
  customEnd: string

  /** 自定义日期变更回调（起始或结束日期变化时触发） */
  onCustomChange: (start: string, end: string) => void
}

/**
 * 渲染统计时间范围选择器。
 *
 * @param props 选中范围、切换回调与自定义日期值
 */
function RangeSelector({ value, onChange, customStart, customEnd, onCustomChange }: RangeSelectorProps) {
  return (
    <div className="range-selector" role="radiogroup" aria-label="统计时间范围">
      {RANGE_KEYS.map((key) => (
        <label className="range-selector__option" key={key}>
          <input
            type="radio"
            name="statistics-range"
            value={key}
            checked={value === key}
            onChange={() => onChange(key)}
          />
          <span className="range-selector__label">{RANGE_LABELS[key]}</span>
        </label>
      ))}
      {value === 'custom' && (
        <div className="range-selector__custom">
          <label className="range-selector__date">
            开始
            <input
              type="date"
              value={customStart}
              onChange={(e) => onCustomChange(e.target.value, customEnd)}
            />
          </label>
          <label className="range-selector__date">
            结束
            <input
              type="date"
              value={customEnd}
              onChange={(e) => onCustomChange(customStart, e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  )
}

export default RangeSelector
