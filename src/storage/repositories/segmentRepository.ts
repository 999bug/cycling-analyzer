/**
 * 赛段仓库接口（后续工作项：完整 Segment）。
 *
 * 赛段为用户从骑行详情页创建的起终点圆对，接口只管持久化，
 * 轨迹匹配逻辑在 features/segments/segmentMatching.ts（纯函数）。
 * 成绩（segment_efforts，v6）随本仓库一起读写：赛段与成绩一对一生命周期，
 * 删除赛段必须级联删成绩，合并到一个仓库避免调用方漏删。
 */
import { db, type SegmentEffortEntity, type SegmentEntity } from '@/storage/db'

/** 新增/回写赛段成绩的字段（id/createdAt 由仓库生成，segmentId/activityId 由方法参数提供） */
export type NewSegmentEffort = Omit<
  SegmentEffortEntity,
  'id' | 'createdAt' | 'segmentId' | 'activityId'
>

/** 全量扫描替换写入的成绩（自带 activityId，segmentId 由方法参数提供） */
export type ScannedSegmentEffort = Omit<SegmentEffortEntity, 'id' | 'createdAt' | 'segmentId'>

/**
 * 赛段仓库接口（测试可注入内存实现）。
 */
export interface SegmentRepository {
  /**
   * 新增赛段。
   *
   * @param segment 赛段字段（不含自增 id）
   * @returns 生成的赛段 id
   */
  addSegment(segment: Omit<SegmentEntity, 'id'>): Promise<number>

  /**
   * 列出全部赛段（按创建顺序）。
   */
  listSegments(): Promise<SegmentEntity[]>

  /**
   * 按 id 取单个赛段。
   *
   * @param id 赛段 id
   * @returns 赛段实体；不存在返回 undefined
   */
  getSegment(id: number): Promise<SegmentEntity | undefined>

  /**
   * 删除赛段（级联删除该赛段的全部成绩）。
   *
   * @param id 赛段 id
   */
  deleteSegment(id: number): Promise<void>

  /**
   * 更新赛段成绩同步时间标记（effortsSyncedAt，非索引字段）。
   *
   * @param id 赛段 id
   * @param syncedAt ISO 8601 时间；不传取当前时间
   */
  markEffortsSynced(id: number, syncedAt?: string): Promise<void>

  /**
   * 列出某赛段的全部成绩（按用时升序，最快在前）。
   *
   * @param segmentId 赛段 id
   */
  listEffortsBySegment(segmentId: number): Promise<SegmentEffortEntity[]>

  /**
   * 用全量扫描结果整体替换某赛段的成绩（事务内先删后加，幂等）。
   * 附带清除 effortsSyncedAt 之外无需调用方再打标记——写成绩即视为已同步。
   *
   * @param segmentId 赛段 id
   * @param efforts 扫描产出的成绩列表（自带 activityId，不含 id/createdAt/segmentId）
   */
  replaceSegmentEfforts(segmentId: number, efforts: readonly ScannedSegmentEffort[]): Promise<void>

  /**
   * 单活动成绩回写（详情页实时匹配后的增量 upsert）：
   * [segmentId+activityId] 命中则更新，否则新增；effort 传 null 删除该活动成绩。
   *
   * @param segmentId 赛段 id
   * @param activityId 活动 id
   * @param effort 本次匹配结果；null 表示该活动不再穿越此赛段（如赛段被编辑）
   */
  upsertActivityEffort(
    segmentId: number,
    activityId: string,
    effort: NewSegmentEffort | null,
  ): Promise<void>

  /**
   * 删除某活动的全部赛段成绩（活动删除时级联调用）。
   *
   * @param activityId 活动 id
   */
  deleteEffortsByActivity(activityId: string): Promise<void>
}

/**
 * Dexie 赛段仓库实现。
 */
export class DexieSegmentRepository implements SegmentRepository {
  /** 数据库实例（构造注入，测试传独立库） */
  private readonly database: typeof db

  constructor(database: typeof db = db) {
    this.database = database
  }

  async addSegment(segment: Omit<SegmentEntity, 'id'>): Promise<number> {
    // 自增主键落库后必回填；EntityTable 对可选主键的返回类型标为 number | undefined，此处收窄
    const id = await this.database.segments.add(segment as SegmentEntity)
    return id as number
  }

  async listSegments(): Promise<SegmentEntity[]> {
    return this.database.segments.toArray()
  }

  async getSegment(id: number): Promise<SegmentEntity | undefined> {
    return this.database.segments.get(id)
  }

  async deleteSegment(id: number): Promise<void> {
    // 级联删成绩：赛段没了成绩无意义，事务保证不留孤儿行
    await this.database.transaction('rw', [this.database.segments, this.database.segment_efforts], async () => {
      const effortIds = await this.database.segment_efforts
        .where('segmentId')
        .equals(id)
        .primaryKeys()
      if (effortIds.length > 0) {
        await this.database.segment_efforts.bulkDelete(effortIds)
      }
      await this.database.segments.delete(id)
    })
  }

  async markEffortsSynced(id: number, syncedAt?: string): Promise<void> {
    await this.database.segments.update(id, {
      effortsSyncedAt: syncedAt ?? new Date().toISOString(),
    })
  }

  async listEffortsBySegment(segmentId: number): Promise<SegmentEffortEntity[]> {
    const efforts = await this.database.segment_efforts
      .where('segmentId')
      .equals(segmentId)
      .toArray()
    return efforts.sort((a, b) => a.durationSeconds - b.durationSeconds)
  }

  async replaceSegmentEfforts(
    segmentId: number,
    efforts: readonly ScannedSegmentEffort[],
  ): Promise<void> {
    await this.database.transaction('rw', this.database.segment_efforts, async () => {
      const oldIds = await this.database.segment_efforts
        .where('segmentId')
        .equals(segmentId)
        .primaryKeys()
      await this.database.segment_efforts.bulkDelete(oldIds)
      const now = new Date().toISOString()
      await this.database.segment_efforts.bulkAdd(
        efforts.map((effort) => ({ ...effort, segmentId, createdAt: now })),
      )
    })
    // 全量替换即视为已同步（调用方扫描完成后统一调，幂等）
    await this.markEffortsSynced(segmentId)
  }

  async upsertActivityEffort(
    segmentId: number,
    activityId: string,
    effort: NewSegmentEffort | null,
  ): Promise<void> {
    await this.database.transaction('rw', this.database.segment_efforts, async () => {
      const existing = await this.database.segment_efforts
        .where('[segmentId+activityId]')
        .equals([segmentId, activityId])
        .first()
      if (effort === null) {
        if (existing?.id !== undefined) {
          await this.database.segment_efforts.delete(existing.id)
        }
        return
      }
      if (existing?.id !== undefined) {
        await this.database.segment_efforts.update(existing.id, { ...effort, segmentId, activityId })
      } else {
        await this.database.segment_efforts.add({
          ...effort,
          segmentId,
          activityId,
          createdAt: new Date().toISOString(),
        } as SegmentEffortEntity)
      }
    })
  }

  async deleteEffortsByActivity(activityId: string): Promise<void> {
    const effortIds = await this.database.segment_efforts
      .where('activityId')
      .equals(activityId)
      .primaryKeys()
    if (effortIds.length > 0) {
      await this.database.segment_efforts.bulkDelete(effortIds)
    }
  }
}
