/**
 * 训练效果（Garmin TE 指标）纯逻辑：分档文案与量表常量。
 *
 * 与 TrainingEffectSection 组件分离，避免 react-refresh 对组件文件
 * 导出非组件成员的限制。
 */

/** 训练效果量表上限 */
export const EFFECT_SCALE_MAX = 5

/**
 * 训练效果分档文案（Garmin 口径）。
 *
 * @param value 效果值（0-5）
 * @returns 分档文案
 */
export function describeTrainingEffect(value: number): string {
  if (value < 1.0) {
    return '无效果'
  }
  if (value < 2.0) {
    return '恢复'
  }
  if (value < 3.0) {
    return '维持'
  }
  if (value < 4.0) {
    return '改善'
  }
  if (value < 5.0) {
    return '大幅提高'
  }
  return '极限'
}
