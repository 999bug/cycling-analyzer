/**
 * FIT 解析错误类型（独立模块，性能优化）。
 *
 * 从 fitDecoder 拆出：errorClassifier 只需错误类型做实例判断，
 * 独立模块避免把 @garmin/fitsdk（约 400KB）经错误类引用拉进主包，
 * fitsdk 只随解析 worker chunk 加载。
 */

/** FIT 解析错误基类 */
export class FitParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FitParseError'
  }
}

/** 不是有效的 FIT 文件 */
export class NotFitFileError extends FitParseError {
  constructor() {
    super('Not a valid FIT file')
    this.name = 'NotFitFileError'
  }
}

/** FIT 完整性校验失败（CRC 错误） */
export class CorruptedFitError extends FitParseError {
  constructor() {
    super('FIT file CRC check failed')
    this.name = 'CorruptedFitError'
  }
}
