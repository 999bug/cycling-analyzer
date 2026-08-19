/**
 * 批量导入数据源定义。
 *
 * FIT 文件本身是通用格式（Garmin SDK 可解析所有来源），各来源差异仅在元数据：
 * - Strava 批量导出目录含 activities.csv（标题/描述/估算功率还原，规格 §31）
 * - 佳明/igpsport/行者等来源无标准 CSV，标题按文件名兜底提取
 * 数据源仅影响目录批量导入（是否解析 CSV）；单文件导入/拖拽无需来源。
 */

/**
 * 批量导入数据源（目录导入入口区分，单文件导入不适用）。
 */
export type ImportSource = 'strava' | 'other';

/**
 * 数据源入口配置（目录导入按钮展示）。
 */
export interface ImportSourceOption {
  /** 数据源标识 */
  value: ImportSource;

  /** 目录导入按钮文案 */
  label: string;

  /** 说明文案（标题/描述还原方式） */
  hint: string;
}

/**
 * 目录批量导入入口（两种来源行为：是否解析 Strava activities.csv）。
 */
export const IMPORT_SOURCE_OPTIONS: ImportSourceOption[] = [
  {
    value: 'strava',
    label: '选择目录（Strava 导出）',
    hint: '解析 activities.csv，自动还原标题/描述/估算功率',
  },
  {
    value: 'other',
    label: '选择目录（其他设备）',
    hint: '佳明 / igpsport / 行者等，标题按文件名还原',
  },
];

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