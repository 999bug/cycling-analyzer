/**
 * 批量导入数据源定义。
 *
 * FIT 文件本身是通用格式（Garmin SDK 可解析所有来源），各来源差异仅在元数据：
 * - Strava 批量导出目录含 activities.csv（标题/描述/估算功率还原，规格 §31）
 * - 佳明/igpsport/行者等来源无标准 CSV，标题按文件名兜底提取
 * 数据源选择决定目录扫描时是否解析 CSV（显式区分，避免误读其他来源的 CSV）。
 */

/**
 * 导入数据源。
 */
export type ImportSource = 'strava' | 'garmin' | 'igpsport' | 'xingzhe' | 'other';

/**
 * 数据源选项（UI 下拉展示）。
 */
export interface ImportSourceOption {
  /** 数据源标识 */
  value: ImportSource;

  /** 展示名 */
  label: string;

  /** 说明文案（标题/描述还原方式） */
  hint: string;
}

/** 默认数据源（与旧行为一致：按 Strava 批量导出解析） */
export const DEFAULT_IMPORT_SOURCE: ImportSource = 'strava';

/**
 * 全部数据源选项。
 */
export const IMPORT_SOURCE_OPTIONS: ImportSourceOption[] = [
  {
    value: 'strava',
    label: 'Strava',
    hint: '目录含 activities.csv，自动还原标题/描述/估算功率',
  },
  { value: 'garmin', label: '佳明 Garmin', hint: '无 CSV 元数据，标题按文件名还原' },
  { value: 'igpsport', label: 'igpsport 迹驰', hint: '无 CSV 元数据，标题按文件名还原' },
  { value: 'xingzhe', label: '行者', hint: '无 CSV 元数据，标题按文件名还原' },
  { value: 'other', label: '其他设备', hint: '无 CSV 元数据，标题按文件名还原' },
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