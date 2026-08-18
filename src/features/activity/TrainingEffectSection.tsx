/**
 * 训练效果区块（Garmin TE 指标）。
 *
 * 展示有氧/无氧训练效果（0-5 分），数值渲染为进度条：
 * 有氧绿色、无氧橙色；分档文案与 Garmin 口径一致。
 * 两项均缺失（设备未提供）时区块不渲染，单项缺失显示 '—'（不伪造）。
 */
import '@/features/activity/trainingEffectSection.css'
import { describeTrainingEffect, EFFECT_SCALE_MAX } from '@/features/activity/trainingEffect'

/** 有氧效果条颜色（绿色） */
const AEROBIC_COLOR = '#22c55e'

/** 无氧效果条颜色（橙色） */
const ANAEROBIC_COLOR = '#f97316'

/**
 * 训练效果区块 props。
 */
export interface TrainingEffectSectionProps {
  /** 有氧训练效果（0-5，缺失为 undefined） */
  aerobic: number | undefined

  /** 无氧训练效果（0-5，缺失为 undefined） */
  anaerobic: number | undefined
}

/**
 * 单项效果行：标签 + 数值 + 分档文案 + 进度条。
 *
 * @param label 行标签（有氧/无氧）
 * @param value 效果值（缺失为 undefined）
 * @param color 进度条颜色
 */
function EffectRow({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  // 宽度保留 1 位小数，避免 4.2/5 之类的浮点长尾
  const percent = value === undefined ? 0 : Math.min(100, Math.round((value / EFFECT_SCALE_MAX) * 1000) / 10)
  return (
    <div className="training-effect__row">
      <span className="training-effect__label">{label}</span>
      <span className="training-effect__value">
        {value === undefined ? '—' : `${value.toFixed(1)} ${describeTrainingEffect(value)}`}
      </span>
      <div
        className="training-effect__bar"
        role="progressbar"
        aria-label={`${label}效果`}
        aria-valuemin={0}
        aria-valuemax={EFFECT_SCALE_MAX}
        aria-valuenow={value ?? 0}
      >
        <div
          className="training-effect__bar-fill"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

/**
 * 训练效果区块。
 *
 * @param props 组件参数
 */
function TrainingEffectSection({ aerobic, anaerobic }: TrainingEffectSectionProps) {
  if (aerobic === undefined && anaerobic === undefined) {
    return null
  }

  return (
    <section className="training-effect" aria-label="训练效果">
      <h2 className="training-effect__title">训练效果</h2>
      <EffectRow label="有氧" value={aerobic} color={AEROBIC_COLOR} />
      <EffectRow label="无氧" value={anaerobic} color={ANAEROBIC_COLOR} />
    </section>
  )
}

export default TrainingEffectSection
