/**
 * FTP / VO2Max 估算（规格 §39 P2）。
 *
 * 经典估算公式：
 * - FTP = 近 90 天 20 分钟最佳平均功率 × 0.95（取整数瓦特）
 * - VO2Max = 10.8 × 近 90 天 5 分钟最佳平均功率 ÷ 体重 + 7（ml/kg/min，1 位小数）
 *
 * 不伪造原则（规格 §26）：最佳功率缺失/非正、体重缺失/非正时
 * 返回 undefined，由 UI 显示引导文案而非占位数字。
 */

/** FTP 估算系数：20 分钟最佳功率 × 0.95 */
export const FTP_ESTIMATE_FACTOR = 0.95

/** FTP 估算所需的最佳功率时长（秒）：20 分钟 */
export const FTP_POWER_DURATION_SECONDS = 1200

/** VO2Max 估算所需的最佳功率时长（秒）：5 分钟 */
export const VO2MAX_POWER_DURATION_SECONDS = 300

/** 估算扫描窗口（天）：仅统计近 90 天的骑行 */
export const ESTIMATE_WINDOW_DAYS = 90

/** VO2Max 公式功率系数（ml/min per W） */
const VO2MAX_POWER_COEFFICIENT = 10.8

/** VO2Max 公式常数项（ml/kg/min） */
const VO2MAX_BASE = 7

/**
 * 估算 FTP：20 分钟最佳平均功率 × 0.95。
 *
 * @param bestPower20min 近 90 天 20 分钟最佳平均功率（W，可缺失）
 * @returns 估算 FTP（W，整数）；输入缺失或非法时 undefined
 */
export function estimateFtp(bestPower20min: number | undefined): number | undefined {
  if (!isPositiveFinite(bestPower20min)) {
    return undefined
  }
  return Math.round(bestPower20min * FTP_ESTIMATE_FACTOR)
}

/**
 * 估算 VO2Max：10.8 × 5 分钟最佳平均功率 ÷ 体重 + 7。
 *
 * @param bestPower5min 近 90 天 5 分钟最佳平均功率（W，可缺失）
 * @param weightKg 体重（kg，可缺失）
 * @returns 估算 VO2Max（ml/kg/min，1 位小数）；任一输入缺失或非法时 undefined
 */
export function estimateVo2max(
  bestPower5min: number | undefined,
  weightKg: number | undefined,
): number | undefined {
  if (!isPositiveFinite(bestPower5min) || !isPositiveFinite(weightKg)) {
    return undefined
  }
  const estimate = (VO2MAX_POWER_COEFFICIENT * bestPower5min) / weightKg + VO2MAX_BASE
  return Math.round(estimate * 10) / 10
}

/**
 * 判断是否为正的有限数。
 *
 * @param value 待判断值
 */
function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}
