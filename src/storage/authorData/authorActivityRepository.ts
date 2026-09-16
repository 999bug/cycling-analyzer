/**
 * 作者数据快照的只读活动仓库（ActivityReadRepository 实现）。
 *
 * 数据来自构建产物快照（public/author-data/），经 SnapshotClient 懒加载：
 * 摘要一次拉取内存驻留（百 KB 级），逐点记录按活动文件按需加载。
 * 列表查询与 Dexie 实现共用 queryActivityList 纯函数，保证两数据源行为一致。
 * 只读：不写快照；existsByFingerprint 恒 false（访客指纹去重只查本地库）。
 */
import type { ActivityRecord } from '@/types/activity'
import {
  DEFAULT_RECORD_BATCH_SIZE,
  queryActivityList,
  type ActivityListOptions,
  type ActivityListResult,
  type ActivityRangeSummary,
  type ActivityReadRepository,
  type ActivitySummary,
  type RecordBatchOptions,
  type RecordQueryOptions,
  type RouteEndpoints,
} from '@/storage/repositories/activityRepository'
import { readRouteEndpoints } from '@/storage/repositories/activityRepository'
import type { SnapshotClient } from '@/storage/authorData/snapshotClient'

/** 作者快照只读活动仓库。 */
export class AuthorActivityRepository implements ActivityReadRepository {
  private readonly client: SnapshotClient

  /**
   * @param client 快照客户端（测试注入假实现）
   */
  constructor(client: SnapshotClient) {
    this.client = client
  }

  async getById(id: string): Promise<ActivitySummary | undefined> {
    const all = await this.client.getActivities()
    return all.find((activity) => activity.id === id)
  }

  async getRecords(activityId: string, options: RecordQueryOptions = {}): Promise<ActivityRecord[]> {
    const { offset = 0, limit = 0 } = options
    const records = await this.client.getRecords(activityId)
    return limit > 0 ? records.slice(offset, offset + limit) : records.slice(offset)
  }

  async getRecordsByActivityIds(activityIds: readonly string[]): Promise<Map<string, ActivityRecord[]>> {
    // 作者源全量轨迹扫描走预计算产物（getTracks），不逐点拉取；
    // 接口完整性起见返回空映射（调用方不应在作者源下依赖此方法）
    void activityIds
    return new Map()
  }

  async iterateRecordBatches(
    activityIds: readonly string[],
    visit: (
      batch: ReadonlyMap<string, ActivityRecord[]>,
    ) => void | boolean | Promise<void | boolean>,
    options?: RecordBatchOptions,
  ): Promise<void> {
    // **刻意不返回快照里的真实逐点数据**，与本类 getRecordsByActivityIds 的既有语义一致：
    // 作者源的全量轨迹扫描走 CI 预计算产物（getTracks / getRouteTracks），不逐点拉取。
    // 而赛段创建预览与赛段挖掘这两个调用点**没有作者源分支**，若这里返回真实记录，
    // 访客的本地库会被写入「由站主快照推导出的成绩」——那是本次重构之外的行为变化。
    // 因此这里按活动逐条给出空记录，让调用方走与改造前完全相同的路径。
    const total = activityIds.length
    if (total === 0) {
      return
    }
    const requested = options?.batchSize ?? DEFAULT_RECORD_BATCH_SIZE
    const batchSize = requested > 0 ? requested : total
    for (let offset = 0; offset < total; offset += batchSize) {
      const slice = activityIds.slice(offset, offset + batchSize)
      const batch = new Map<string, ActivityRecord[]>()
      for (const id of slice) {
        batch.set(id, [])
      }
      const keepGoing = await visit(batch)
      options?.onProgress?.(Math.min(offset + batchSize, total), total)
      if (keepGoing === false) {
        return
      }
    }
  }

  async getRouteEndpoints(activityId: string): Promise<RouteEndpoints | undefined> {
    // 只读源：端点由 CI 预计算写进摘要，缺失时不回退读取轨迹（快照逐点按活动文件加载，代价高）
    const summary = await this.getById(activityId)
    return summary === undefined ? undefined : readRouteEndpoints(summary)
  }

  async listActivities(options?: ActivityListOptions): Promise<ActivityListResult> {
    return queryActivityList(await this.client.getActivities(), options)
  }

  async countActivities(): Promise<number> {
    return (await this.client.getActivities()).length
  }

  async existsByFingerprint(): Promise<boolean> {
    return false
  }

  async summarizeByRange(startTime: string, endTime: string): Promise<ActivityRangeSummary> {
    // ISO 8601 字符串范围比较，字典序即时间序（含边界，与 Dexie 实现一致）
    const all = await this.client.getActivities()
    const summary: ActivityRangeSummary = {
      count: 0,
      totalDistance: 0,
      totalDuration: 0,
      totalElevationGain: 0,
    }
    for (const activity of all) {
      if (activity.startTime < startTime || activity.startTime > endTime) {
        continue
      }
      summary.count++
      summary.totalDistance += activity.distance
      summary.totalDuration += activity.duration
      // 无海拔数据源（行者 GPX）爬升为 undefined：聚合按 0 参与
      summary.totalElevationGain += activity.elevationGain ?? 0
    }
    return summary
  }

  async listAllSummaries(): Promise<ActivitySummary[]> {
    const all = await this.client.getActivities()
    return [...all].sort((a, b) => b.startTime.localeCompare(a.startTime))
  }
}
