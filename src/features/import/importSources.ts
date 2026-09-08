/**
 * 批量导入数据源定义。
 *
 * FIT 文件本身是通用格式（Garmin SDK 可解析所有来源），各来源差异仅在元数据：
 * - Strava 批量导出目录含 activities.csv（标题/描述/估算功率还原，规格 §31）
 * - 佳明 GDPR 全量导出包 FIT 封装在内层 zip，活动摘要 JSON 按开始时间还原标题
 * - igpsport/行者等来源无标准元数据，标题按文件名兜底提取
 * 数据源仅影响目录批量导入（是否解析元数据）；单文件导入/拖拽无需来源。
 * 数据源不再由用户手选：导入向导按所选平台自动确定（platformGuides.ts）。
 */

/**
 * 批量导入数据源（目录导入入口区分，单文件导入不适用）。
 */
export type ImportSource = 'strava' | 'garmin' | 'other';

/**
 * 判断数据源是否解析 Strava activities.csv。
 * 仅 Strava 批量导出目录含该 CSV；其他来源显式跳过，避免误读。
 *
 * @param source 数据源
 * @returns 是否解析 CSV
 */
export function isStravaSource(source: ImportSource): boolean {
  return source === 'strava';
}
