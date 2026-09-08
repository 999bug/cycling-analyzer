/**
 * 佳明（Garmin）GDPR 导出包适配（规格外扩展：佳明批量导入）。
 *
 * 佳明「账户数据导出」（GDPR 全量包）结构与普通 FIT 批量导出不同：
 * - FIT 原始文件封装在 DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_*.zip 内层压缩包；
 * - 活动摘要（含真实活动名）在 DI_CONNECT/DI-Connect-Fitness/*_summarizedActivities.json，
 *   字段为 startTimeGmt（Unix 毫秒）+ name；
 * - 摘要 JSON 与 FIT 文件名无键关联（uuid 字段对不上文件名 ID），
 *   只能按「活动开始时间」匹配还原标题。
 *
 * 本模块只做纯函数解析与匹配（可单测），zip 解压在 scanner 中。
 */

/**
 * 佳明 GDPR 包内「已上传文件」压缩包的目录特征（不区分大小写）。
 */
const GARMIN_UPLOADED_DIR_PATTERN = /(^|\/)di_connect\/di-connect-uploaded-files\//i;

/**
 * 佳明 GDPR 活动摘要 JSON 的文件名特征（如 lishiyan999@gmail.com_1_summarizedActivities.json）。
 */
const GARMIN_SUMMARIES_PATTERN = /summarizedactivities.*\.json$/i;

/**
 * 判断 zip 包路径是否符合佳明 GDPR「已上传文件」特征。
 *
 * @param path zip 相对路径（从所选根目录起）
 */
export function isGarminUploadedZipPath(path: string): boolean {
  return GARMIN_UPLOADED_DIR_PATTERN.test(path);
}

/**
 * 判断文件名是否为佳明 GDPR 活动摘要 JSON。
 *
 * @param fileName 纯文件名
 */
export function isGarminSummariesName(fileName: string): boolean {
  return GARMIN_SUMMARIES_PATTERN.test(fileName);
}

/**
 * 佳明活动摘要的原始条目（仅取本功能关心的字段，其余省略）。
 */
export interface GarminSummaryActivity {
  /** 活动 ID（佳明侧） */
  activityId?: number;

  /** 活动名（如「通州区 公路骑行」） */
  name?: string;

  /** 开始时间（GMT，Unix 毫秒） */
  startTimeGmt?: number;
}

/**
 * 摘要 JSON 顶层结构：[{ summarizedActivitiesExport: [...] }]。
 */
interface GarminSummariesFile {
  summarizedActivitiesExport?: GarminSummaryActivity[];
}

/**
 * 活动标题时间匹配容差（秒）：FIT 设备时间与佳明服务端记录可能有 ±1~2 秒偏差。
 */
export const GARMIN_TITLE_MATCH_TOLERANCE_SEC = 2;

/**
 * 解析佳明 GDPR 活动摘要 JSON，产出「开始时间（Unix 秒）→ 活动名」映射。
 *
 * 文件结构：[{ summarizedActivitiesExport: [...] }]，健壮处理缺字段/非数组形态。
 * 多个活动同秒开始时后者不覆盖前者（首见保留，按数组顺序稳定）。
 *
 * @param text 摘要 JSON 原始文本
 * @returns 开始时间秒 → 活动名（无有效条目时为空映射）
 */
export function parseGarminSummaries(text: string): Map<number, string> {
  const titles = new Map<number, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return titles; // 非法 JSON 静默降级：标题走文件名兜底
  }
  if (!Array.isArray(parsed)) {
    return titles;
  }
  for (const group of parsed) {
    const entries = (group as GarminSummariesFile | null)?.summarizedActivitiesExport;
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      const ms = entry?.startTimeGmt;
      const name = entry?.name;
      if (
        typeof ms !== 'number' ||
        !Number.isFinite(ms) ||
        typeof name !== 'string' ||
        name.trim() === ''
      ) {
        continue;
      }
      const sec = Math.round(ms / 1000);
      if (!titles.has(sec)) {
        titles.set(sec, name.trim());
      }
    }
  }
  return titles;
}

/**
 * 按活动开始时间从佳明摘要映射中匹配活动标题（±容差秒，取最近邻）。
 *
 * @param titles parseGarminSummaries 产出的映射
 * @param startTimeIso 活动 ISO 8601 开始时间（Activity.startTime）
 * @param toleranceSec 匹配容差秒（默认 GARMIN_TITLE_MATCH_TOLERANCE_SEC）
 */
export function matchGarminTitle(
  titles: Map<number, string>,
  startTimeIso: string,
  toleranceSec: number = GARMIN_TITLE_MATCH_TOLERANCE_SEC,
): string | undefined {
  const startMs = Date.parse(startTimeIso);
  if (!Number.isFinite(startMs)) {
    return undefined;
  }
  const sec = Math.round(startMs / 1000);
  for (let delta = 0; delta <= toleranceSec; delta++) {
    // 先查正偏移再查负偏移：佳明摘要时间晚于设备时间为主（上传延迟场景未见明显方向性，取稳定顺序即可）
    const forward = titles.get(sec + delta) ?? titles.get(sec - delta);
    if (forward !== undefined) {
      return forward;
    }
  }
  return undefined;
}
