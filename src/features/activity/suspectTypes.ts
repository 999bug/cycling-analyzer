/**
 * 存量活动类型复核：找出「类型标注可能不准」的活动，供批量修正弹窗展示。
 *
 * **只读**，不修改任何数据。是否改写由用户在弹窗中勾选确认后决定——
 * 自动推断只能「发现」，不能「悄悄改数字」：
 *   - 误判代价不对称：把真骑行误改成跑步，用户里程凭空少一截且无从解释，
 *     比统计偏大严重得多；
 *   - 静默改历史统计会让用户看到「上次 3000km 今天 2400km」且无操作痕迹。
 *
 * 两方向都检测，对应两类真实问题：
 * 1. **当前记为骑行、实际疑似非骑行**（本功能要解决的主问题）：
 *    旧版 GPX 解析对缺失 `<type>` 默认 cycling，导致导入的跑步/散步
 *    被计入骑行口径，表现是「骑行里程虚高」；
 * 2. **当前未记为骑行、特征明确是骑行**（找回）：归入「其他」的未知类型，
 *    或此前被误改成跑步/步行的真骑行——若该条速度特征明确
 *    （均速 ≥20 或距离 ≥50km，high 置信），提示用户改回骑行，
 *    避免真骑行从统计里消失。
 *
 * 判定用同一套 `inferActivityType`，与导入期兜底完全一致，
 * 避免「导入时判成 A、复核时判成 B」的口径分裂。
 */
import { inferActivityType, describeTypeInference, isTypeSuspect, type TypeConfidence } from '@/features/activity/activityTypeInference'
import { isCyclingType, type ActivityType } from '@/types/activityType'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/**
 * 一条待复核记录。
 */
export interface TypeSuspect {
  /** 活动摘要（弹窗展示标题/距离/均速用） */
  summary: ActivitySummary

  /** 当前记录的类型（原始存储值，可能为各平台写法） */
  currentType: string

  /** 建议修正为的类型 */
  suggestedType: ActivityType

  /** 判定置信度 */
  confidence: TypeConfidence

  /** 判定依据文案（展示给用户，供其自行判断是否采纳） */
  basis: string
}

/**
 * 检测类型标注可疑的活动（按开始时间倒序，与列表页一致）。
 *
 * @param summaries 全量活动摘要（**不要预先过滤**：本函数需要看到其他类型）
 * @returns 待复核候选列表；无候选时为空数组
 */
export function detectTypeSuspects(summaries: readonly ActivitySummary[]): TypeSuspect[] {
  const suspects: TypeSuspect[] = []
  for (const summary of summaries) {
    const inference = inferActivityType(summary)
    if (isCyclingType(summary.activityType)) {
      // 情形 1：记为骑行但推断为非骑行（灰区也列出，由用户拍板）。
      // 灰区建议保持骑行——10~20 km/h 的通勤骑与快跑重叠，「建议跑步」曾把
      // 均速 18.9 km/h 的真骑行误导成跑步（2026-09-11 用户反馈），改为保守
      // 建议维持原类型，用户确需修改时用弹窗的类型下拉手动指定。
      if (isTypeSuspect(inference)) {
        suspects.push({
          summary,
          currentType: summary.activityType,
          suggestedType: inference.confidence === 'grey' ? 'cycling' : inference.type,
          confidence: inference.confidence,
          basis: describeTypeInference(inference),
        })
      }
      continue
    }
    // 情形 2：未记为骑行但特征明确是骑行——只在 high 置信时才提示，
    // 否则会把「划船」「滑雪」这类无关活动也列进来。覆盖两类来源：
    // 归入「其他」的未知类型，以及此前被误改成跑步/步行的真骑行——
    // 改错后原检测不再覆盖该条，用户无从在弹窗里改回，故一并纳入
    if (inference.type === 'cycling' && inference.confidence === 'high') {
      suspects.push({
        summary,
        currentType: summary.activityType,
        suggestedType: 'cycling',
        confidence: inference.confidence,
        basis: describeTypeInference(inference),
      })
    }
  }
  return suspects.sort((a, b) => b.summary.startTime.localeCompare(a.summary.startTime))
}

/**
 * 是否需要用户主动确认（灰区不得默认勾选）。
 *
 * @param suspect 待复核记录
 * @returns 灰区返回 true
 */
export function isGreySuspect(suspect: TypeSuspect): boolean {
  return suspect.confidence === 'grey'
}

/**
 * 默认勾选策略：高/中置信度默认勾选，灰区默认不勾。
 *
 * 依据来自速度特征时置信度最多到 medium，故「默认勾选」不等于「保证正确」；
 * 弹窗仍需逐条展示判定依据供用户复核。
 *
 * @param suspects 候选列表
 * @returns 默认勾选的候选 ID 集合
 */
export function defaultSelectedIds(suspects: readonly TypeSuspect[]): Set<string> {
  return new Set(suspects.filter((item) => !isGreySuspect(item)).map((item) => item.summary.id))
}

/**
 * 按当前勾选与手动指定计算修正前后的骑行口径影响（弹窗顶部预览用）。
 *
 * 骑行总里程/次数只统计「修正后仍为骑行」的活动：
 * 勾选把某条改成非骑行即从骑行口径移出，取消勾选则保留。
 *
 * @param allSummaries 全量活动摘要
 * @param suspects 候选列表
 * @param selectedIds 当前勾选的活动 ID
 * @param overrides 用户手动指定的目标类型（id → 类型）；未指定的用建议类型
 * @returns 修正前后的骑行里程（米）与次数
 */
export function summarizeTypeFixImpact(
  allSummaries: readonly ActivitySummary[],
  suspects: readonly TypeSuspect[],
  selectedIds: ReadonlySet<string>,
  overrides: ReadonlyMap<string, ActivityType> = new Map(),
): { beforeDistance: number; afterDistance: number; beforeCount: number; afterCount: number } {
  const suggestionById = new Map(suspects.map((item) => [item.summary.id, item.suggestedType]))
  let beforeDistance = 0
  let afterDistance = 0
  let beforeCount = 0
  let afterCount = 0

  for (const summary of allSummaries) {
    const suggestion = suggestionById.get(summary.id)
    const applied = suggestion !== undefined && selectedIds.has(summary.id)
    const wasCycling = isCyclingType(summary.activityType)
    // 勾选则按「手动指定 ?? 建议」落定，未勾选保持原样
    const willBeCycling = applied
      ? (overrides.get(summary.id) ?? suggestion) === 'cycling'
      : wasCycling

    if (wasCycling) {
      beforeDistance += summary.distance
      beforeCount += 1
    }
    if (willBeCycling) {
      afterDistance += summary.distance
      afterCount += 1
    }
  }

  return { beforeDistance, afterDistance, beforeCount, afterCount }
}
