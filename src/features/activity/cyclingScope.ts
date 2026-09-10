/**
 * 骑行统计口径：把非骑行活动排除在骑行语义的分析之外。
 *
 * 背景：本站定位是骑行数据分析，但导入 Strava / 佳明等批量导出包时，
 * 包里往往同时含有跑步、散步、徒步。这些活动若被计入骑行口径，
 * 用户看到的「骑行总里程」会凭空变大且无法解释。故所有骑行语义页面
 * （统计、仪表盘、年度回顾、日历、热力图、路线图、性能、训练计划、
 * 相似骑行、对比、个人最佳、训练状态、车辆与设备统计、赛段）
 * 取数一律经过本模块，而不是直接调用 `repository.listAllSummaries()`。
 *
 * **不做过滤的两处例外**（有意为之）：
 * - 骑行记录列表页：数据管理入口，用户必须能看到并修正自己导入了什么；
 * - 数据导出 / 清空 / 补算等维护任务：备份语义，换机要能完整还原。
 *
 * **使用约定（硬约束）**：需要全量摘要的分析类页面请调用
 * `listCyclingSummaries(repository)`；禁止直接 `repository.listAllSummaries()`
 * 后再自行过滤——热力图 / 路线图 / 赛段 / 统计页的抽稀缓存以
 * `summariesScanKey(summaries)` 为键，**过滤必须发生在计算指纹之前**：
 * 若先按全量算指纹再过滤，会永久命中「混了非骑行轨迹」的旧缓存
 * （缓存在 IndexedDB 中跨会话存活，刷新页面不会自愈）。
 */
import { isCyclingType } from '@/types/activityType'
import { getSettings, saveSettings } from '@/features/settings/settings'
import type { SettingsRepository } from '@/storage/repositories/settingsRepository'
import type {
  ActivityReadRepository,
  ActivitySummary,
} from '@/storage/repositories/activityRepository'

/**
 * 运行时镜像：统计是否包含非骑行运动。
 *
 * 读设置在启动时一次（initCyclingScope），改设置时经 switchIncludeOtherSports
 * 同步；放模块级而非 store，是为了让 20 余处取数点保持单行改动、
 * 且各页面的加载 effect 不必新增依赖项。
 */
let includeOtherSports = false

/**
 * 初始化骑行统计口径：读取持久化设置写入运行时镜像。
 * 读取失败保持默认「只统计骑行」。
 *
 * @param settingsRepository 设置仓库（测试注入独立实例）
 */
export async function initCyclingScope(settingsRepository?: SettingsRepository): Promise<void> {
  try {
    const settings = await getSettings(settingsRepository)
    includeOtherSports = settings.data.includeOtherSports
  } catch (error) {
    console.error('Failed to initialize cycling scope', error)
  }
}

/**
 * 切换「统计包含其他运动」：先更新运行时镜像立即生效，再持久化。
 *
 * 调用方需在切换后整页刷新——各页面为挂载时快照，镜像变化不会自动重载数据。
 *
 * @param value 目标值
 * @param settingsRepository 设置仓库（测试注入独立实例）
 */
export async function switchIncludeOtherSports(
  value: boolean,
  settingsRepository?: SettingsRepository,
): Promise<void> {
  includeOtherSports = value
  await saveSettings({ data: { includeOtherSports: value } }, settingsRepository)
}

/**
 * 当前是否把非骑行运动计入统计。
 *
 * @returns 开启返回 true
 */
export function getIncludeOtherSports(): boolean {
  return includeOtherSports
}

/**
 * 仅测试用：直接重置运行时镜像，避免用例间互相污染。
 *
 * @param value 目标值（默认 false，与生产默认一致）
 */
export function resetCyclingScopeForTest(value = false): void {
  includeOtherSports = value
}

/**
 * 过滤出骑行活动（纯函数，尊重「统计包含其他运动」开关）。
 *
 * @param items 任意含 activityType 的列表
 * @returns 骑行活动列表；开关开启时原样返回
 */
export function filterCycling<T extends { activityType: string }>(items: readonly T[]): T[] {
  if (includeOtherSports) {
    return [...items]
  }
  return items.filter((item) => isCyclingType(item.activityType))
}

/**
 * 读取骑行口径下的活动摘要列表（分析类页面的统一取数入口）。
 *
 * 已按当前口径过滤，可直接用于 `summariesScanKey()` 与各类聚合。
 *
 * @param repository 活动仓库（本地 Dexie 或作者快照均可）
 * @returns 骑行活动摘要列表
 */
export async function listCyclingSummaries(
  repository: ActivityReadRepository,
): Promise<ActivitySummary[]> {
  return filterCycling(await repository.listAllSummaries())
}
