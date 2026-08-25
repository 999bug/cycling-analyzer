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
  queryActivityList,
  type ActivityListOptions,
  type ActivityListResult,
  type ActivityRangeSummary,
  type ActivityReadRepository,
  type ActivitySummary,
  type RecordQueryOptions,
} from '@/storage/repositories/activityRepository'
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
      summary.totalElevationGain += activity.elevationGain
    }
    return summary
  }

  async listAllSummaries(): Promise<ActivitySummary[]> {
    const all = await this.client.getActivities()
    return [...all].sort((a, b) => b.startTime.localeCompare(a.startTime))
  }
}
