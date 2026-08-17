/**
 * 赛段仓库接口（后续工作项：完整 Segment）。
 *
 * 赛段为用户从骑行详情页创建的起终点圆对，接口只管持久化，
 * 轨迹匹配逻辑在 features/segments/segmentMatching.ts（纯函数）。
 */
import { db, type SegmentEntity } from '@/storage/db'

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
   * 删除赛段。
   *
   * @param id 赛段 id
   */
  deleteSegment(id: number): Promise<void>
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

  async deleteSegment(id: number): Promise<void> {
    return this.database.segments.delete(id)
  }
}
