/**
 * 强度因子（IF）与训练压力分数（TSS）计算（规格 §26）。
 *
 * - IF = NP / FTP：实际强度相对功能阈值功率的比值
 * - TSS = (骑行时长秒 × IF² × 100) / 3600：以 IF=1 持续 1 小时为 100 分基准
 *
 * 依赖用户配置的 FTP：FTP 缺失或参数无效时返回 undefined，不伪造计算（规格 §26）。
 */

/**
 * 计算强度因子（IF）。
 *
 * @param np 标准化功率（W）
 * @param ftp 功能阈值功率（W）
 * @returns IF（NP/FTP）；NP 或 FTP 无效时 undefined
 */
export function calculateIntensityFactor(np: number, ftp: number): number | undefined {
  if (!Number.isFinite(np) || np < 0 || !Number.isFinite(ftp) || ftp <= 0) {
    return undefined
  }
  return np / ftp
}

/**
 * 计算训练压力分数（TSS）。
 *
 * @param durationSeconds 骑行计时时长（秒）
 * @param intensityFactor 强度因子（IF）
 * @param ftp 功能阈值功率（W，仅校验配置有效性）
 * @returns TSS；任意参数无效时 undefined
 */
export function calculateTss(
  durationSeconds: number,
  intensityFactor: number,
  ftp: number,
): number | undefined {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(intensityFactor) ||
    intensityFactor <= 0 ||
    !Number.isFinite(ftp) ||
    ftp <= 0
  ) {
    return undefined
  }
  return (durationSeconds * intensityFactor * intensityFactor * 100) / 3600
}
