/**
 * 活动仓库（activities + activity_records 表，规格 §18）。
 *
 * 职责：活动摘要与逐点数据的增删查、列表查询（排序/分页/筛选/搜索）、
 * 时间范围统计聚合。重复检测通过 fingerprint 唯一索引 + existsByFingerprint 完成。
 *
 * 说明：排序与筛选在内存中完成（个人本地数据量级小，全量过滤保证一致性与
 * 正确性，避免多索引组合的复杂度；数据量增长后可切换到索引路径）。
 */
import type { Activity, ActivityRecord } from '@/types/activity';
import type { ActivityEntity, ActivityRecordEntity, CyclingDatabase } from '@/storage/db';

/**
 * 活动摘要（不含 records/route）。
 * 与 activities 表实体结构一致，UI 列表/统计页直接消费。
 */
export type ActivitySummary = ActivityEntity;

/**
 * 逐点记录查询选项。
 */
export interface RecordQueryOptions {
  /** 分页偏移 */
  offset?: number;

  /** 分页条数（0 或省略 = 全部） */
  limit?: number;
}

/**
 * 活动列表查询选项。
 */
export interface ActivityListOptions {
  /** 排序字段（默认 startTime） */
  sortBy?: 'startTime' | 'distance' | 'duration';

  /** 排序方向（默认 desc） */
  sortOrder?: 'asc' | 'desc';

  /** 分页偏移（默认 0） */
  offset?: number;

  /** 分页条数（默认 20，0 = 不分页） */
  limit?: number;

  /** 月份筛选（ISO 月份前缀，如 2026-08） */
  month?: string;

  /** 运动类型筛选 */
  activityType?: string;

  /** 文本搜索（name/fileName 模糊匹配，忽略大小写） */
  search?: string;

  /** 最小距离（米，undefined = 不限制；规格 §30 数值筛选） */
  minDistance?: number;

  /** 最大距离（米，undefined = 不限制） */
  maxDistance?: number;

  /** 最小累计爬升（米，undefined = 不限制） */
  minElevationGain?: number;

  /** 最大累计爬升（米，undefined = 不限制） */
  maxElevationGain?: number;

  /** 最小平均功率（W，undefined = 不限制；功率缺失的活动不满足条件） */
  minAvgPower?: number;

  /** 最大平均功率（W，undefined = 不限制；功率缺失的活动不满足条件） */
  maxAvgPower?: number;
}

/**
 * 活动列表查询结果。
 */
export interface ActivityListResult {
  /** 当前页活动摘要 */
  items: ActivitySummary[];

  /** 满足筛选条件的总条数（分页前） */
  total: number;
}

/**
 * 时间范围统计聚合结果（Phase 7 Dashboard 用）。
 */
export interface ActivityRangeSummary {
  /** 活动数量 */
  count: number;

  /** 总距离（米） */
  totalDistance: number;

  /** 总骑行时长（秒） */
  totalDuration: number;

  /** 总累计爬升（米） */
  totalElevationGain: number;
}

/**
 * 活动仓库读取接口（规格 §18/§45）。
 * 作者数据快照（只读，fetch 实现）与 Dexie 本地实现共用此接口，
 * UI 经 useActivityRepository hook 按当前源取实例（src/hooks/useActivityRepository.ts）。
 */
export interface ActivityReadRepository {
  /**
   * 按 ID 查询活动摘要（不含逐点记录）。
   *
   * @param id 活动 ID
   * @returns 活动摘要，不存在时 undefined
   */
  getById(id: string): Promise<ActivitySummary | undefined>;

  /**
   * 查询活动的逐点记录（分页可选，Phase 6 详情页按需加载）。
   *
   * @param activityId 活动 ID
   * @param options 分页选项
   * @returns 逐点记录（按存储序返回）
   */
  getRecords(activityId: string, options?: RecordQueryOptions): Promise<ActivityRecord[]>;

  /**
   * 列表查询：排序 + 分页 + 月份/类型筛选 + 文本搜索 + 距离/爬升/功率数值筛选。
   *
   * @param options 查询选项（数值条件均为含边界比较，组合语义为 AND）
   * @returns 当前页摘要与总条数
   */
  listActivities(options?: ActivityListOptions): Promise<ActivityListResult>;

  /**
   * 统计活动总数。
   */
  countActivities(): Promise<number>;

  /**
   * 按文件指纹检测活动是否已导入（重复检测，规格 §9）。
   * 作者快照实现恒返回 false：访客指纹去重只查本地库，与作者数据天然隔离。
   *
   * @param fingerprint 文件 SHA-256 指纹
   */
  existsByFingerprint(fingerprint: string): Promise<boolean>;

  /**
   * 统计指定时间范围（含边界）的活动聚合数据。
   *
   * @param startTime 起始时间（ISO 8601）
   * @param endTime 结束时间（ISO 8601）
   */
  summarizeByRange(startTime: string, endTime: string): Promise<ActivityRangeSummary>;

  /**
   * 返回全部活动摘要（按 startTime 降序，列表页/统计页全量统计用）。
   */
  listAllSummaries(): Promise<ActivitySummary[]>;
}

/**
 * 活动仓库接口。
 * Phase 4-7（导入、列表、详情、统计）依赖此接口，不直接触碰 Dexie。
 */
export interface ActivityRepository extends ActivityReadRepository {
  /**
   * 写入单个活动（摘要 + 逐点记录，事务保证原子性）。
   * fingerprint 重复时抛出 ConstraintError，调用方应先 existsByFingerprint 检测。
   *
   * @param activity 活动（records 可选，为 undefined 时不写逐点表）
   * @param name 活动标题（Strava CSV 还原，可为空）
   */
  addActivity(activity: Activity, name?: string): Promise<void>;

  /**
   * 批量写入多个活动（单事务）。
   *
   * @param activities 活动列表
   */
  addActivities(activities: Activity[]): Promise<void>;

  /**
   * 更新活动标题（列表页/详情页重命名，规格 §31）。
   *
   * @param id 活动 ID
   * @param name 新标题
   */
  updateName(id: string, name: string): Promise<void>;

  /**
   * 更新活动的标准化功率（历史活动 NP 回填；导入时计算，老数据按需补算）。
   *
   * @param id 活动 ID
   * @param normalizedPower 标准化功率（W）
   */
  updateNormalizedPower(id: string, normalizedPower: number): Promise<void>;

  /**
   * 删除活动（连同逐点记录，事务级联删除）。
   *
   * @param id 活动 ID
   */
  deleteActivity(id: string): Promise<void>;

  /**
   * 清空全部活动与逐点记录（不涉及 files/settings）。
   */
  deleteAll(): Promise<void>;
}

/** 默认分页条数 */
const DEFAULT_PAGE_SIZE = 20;

/** 默认排序字段 */
const DEFAULT_SORT_BY = 'startTime';

/** 默认排序方向 */
const DEFAULT_SORT_ORDER = 'desc';

/**
 * 活动列表内存查询（筛选/排序/分页）。
 * Dexie 与作者快照两个仓库实现共用本函数，保证任一数据源行为一致
 * （个人数据量级小，全量过滤 + 内存排序保证多条件组合正确）。
 *
 * @param all 全量活动摘要
 * @param options 查询选项（数值条件含边界，组合语义 AND；avgPower 缺失不满足功率条件）
 * @returns 当前页摘要与满足筛选条件的总条数
 */
export function queryActivityList(
  all: readonly ActivitySummary[],
  options: ActivityListOptions = {},
): ActivityListResult {
  const {
    sortBy = DEFAULT_SORT_BY,
    sortOrder = DEFAULT_SORT_ORDER,
    offset = 0,
    limit = DEFAULT_PAGE_SIZE,
    month,
    activityType,
    search,
    minDistance,
    maxDistance,
    minElevationGain,
    maxElevationGain,
    minAvgPower,
    maxAvgPower,
  } = options;

  let items = [...all];
  if (month) {
    items = items.filter((a) => a.startTime.startsWith(month));
  }
  if (activityType) {
    items = items.filter((a) => a.activityType === activityType);
  }
  if (search) {
    const keyword = search.trim().toLowerCase();
    if (keyword) {
      items = items.filter(
        (a) =>
          a.fileName.toLowerCase().includes(keyword) ||
          (a.name ?? '').toLowerCase().includes(keyword),
      );
    }
  }

  // 数值范围筛选（单位与领域模型一致：距离米、爬升米、功率 W；含边界，组合为 AND）。
  // avgPower 为可选字段：缺失的活动不满足任何功率条件（显式排除 undefined）。
  if (minDistance !== undefined) {
    items = items.filter((a) => a.distance >= minDistance);
  }
  if (maxDistance !== undefined) {
    items = items.filter((a) => a.distance <= maxDistance);
  }
  if (minElevationGain !== undefined) {
    items = items.filter((a) => a.elevationGain >= minElevationGain);
  }
  if (maxElevationGain !== undefined) {
    items = items.filter((a) => a.elevationGain <= maxElevationGain);
  }
  if (minAvgPower !== undefined) {
    items = items.filter((a) => a.avgPower !== undefined && a.avgPower >= minAvgPower);
  }
  if (maxAvgPower !== undefined) {
    items = items.filter((a) => a.avgPower !== undefined && a.avgPower <= maxAvgPower);
  }

  // 排序（startTime 为 ISO 字符串，字典序即时间序；数字字段按值序）
  const direction = sortOrder === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const left = a[sortBy] ?? 0;
    const right = b[sortBy] ?? 0;
    if (left < right) {
      return -direction;
    }
    if (left > right) {
      return direction;
    }
    return 0;
  });

  const total = items.length;
  const page = limit > 0 ? items.slice(offset, offset + limit) : items.slice(offset);
  return { items: page, total };
}

/**
 * Dexie 实现的活动仓库。
 */
export class DexieActivityRepository implements ActivityRepository {
  private readonly db: CyclingDatabase;

  /**
   * @param db 数据库实例（测试可注入独立实例）
   */
  constructor(db: CyclingDatabase) {
    this.db = db;
  }

  async addActivity(activity: Activity, name?: string): Promise<void> {
    const entity = toActivityEntity(activity, name);
    const records = toRecordEntities(activity);
    await this.db.transaction('rw', [this.db.activities, this.db.activity_records], async () => {
      await this.db.activities.add(entity);
      if (records.length > 0) {
        await this.db.activity_records.bulkAdd(records);
      }
    });
  }

  async addActivities(activities: Activity[]): Promise<void> {
    const entities = activities.map((activity) => toActivityEntity(activity));
    const records = activities.flatMap(toRecordEntities);
    await this.db.transaction('rw', [this.db.activities, this.db.activity_records], async () => {
      if (entities.length > 0) {
        await this.db.activities.bulkAdd(entities);
      }
      if (records.length > 0) {
        await this.db.activity_records.bulkAdd(records);
      }
    });
  }

  async getById(id: string): Promise<ActivitySummary | undefined> {
    return this.db.activities.get(id);
  }

  async getRecords(activityId: string, options?: RecordQueryOptions): Promise<ActivityRecord[]> {
    const { offset = 0, limit = 0 } = options ?? {};
    let collection = this.db.activity_records.where('activityId').equals(activityId);
    if (offset > 0) {
      collection = collection.offset(offset);
    }
    if (limit > 0) {
      collection = collection.limit(limit);
    }
    return collection.toArray();
  }

  async listActivities(options?: ActivityListOptions): Promise<ActivityListResult> {
    // 内存过滤：个人本地数据量级小，全量过滤 + 内存排序保证多条件组合正确
    return queryActivityList(await this.db.activities.toArray(), options);
  }

  async countActivities(): Promise<number> {
    return this.db.activities.count();
  }

  async existsByFingerprint(fingerprint: string): Promise<boolean> {
    return (await this.db.activities.where('fingerprint').equals(fingerprint).count()) > 0;
  }

  async updateName(id: string, name: string): Promise<void> {
    await this.db.activities.update(id, { name });
  }

  async updateNormalizedPower(id: string, normalizedPower: number): Promise<void> {
    await this.db.activities.update(id, { normalizedPower });
  }

  async deleteActivity(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.activities, this.db.activity_records], async () => {
      await this.db.activities.delete(id);
      await this.db.activity_records.where('activityId').equals(id).delete();
    });
  }

  async deleteAll(): Promise<void> {
    await this.db.transaction('rw', [this.db.activities, this.db.activity_records], async () => {
      await this.db.activities.clear();
      await this.db.activity_records.clear();
    });
  }

  async summarizeByRange(startTime: string, endTime: string): Promise<ActivityRangeSummary> {
    // ISO 8601 字符串范围比较，字典序即时间序（含边界）
    const activities = await this.db.activities
      .where('startTime')
      .between(startTime, endTime, true, true)
      .toArray();
    const summary: ActivityRangeSummary = {
      count: activities.length,
      totalDistance: 0,
      totalDuration: 0,
      totalElevationGain: 0,
    };
    for (const activity of activities) {
      summary.totalDistance += activity.distance;
      summary.totalDuration += activity.duration;
      summary.totalElevationGain += activity.elevationGain;
    }
    return summary;
  }

  async listAllSummaries(): Promise<ActivitySummary[]> {
    return this.db.activities.orderBy('startTime').reverse().toArray();
  }
}

/**
 * 将领域 Activity 转换为 activities 表实体（剔除 records/route，补充标题）。
 * 显式逐字段映射：确保只落库摘要字段，大数据（records/route）不进 activities 表。
 *
 * @param activity 领域活动
 * @param name 活动标题（可为空）
 */
function toActivityEntity(activity: Activity, name?: string): ActivityEntity {
  return {
    id: activity.id,
    name,
    description: activity.description,
    note: activity.note,
    fileId: activity.fileId,
    fileName: activity.fileName,
    fingerprint: activity.fingerprint,
    activityType: activity.activityType,
    startTime: activity.startTime,
    endTime: activity.endTime,
    duration: activity.duration,
    elapsedTime: activity.elapsedTime,
    distance: activity.distance,
    elevationGain: activity.elevationGain,
    elevationLoss: activity.elevationLoss,
    calories: activity.calories,
    avgSpeed: activity.avgSpeed,
    maxSpeed: activity.maxSpeed,
    avgHeartRate: activity.avgHeartRate,
    maxHeartRate: activity.maxHeartRate,
    avgCadence: activity.avgCadence,
    maxCadence: activity.maxCadence,
    avgPower: activity.avgPower,
    maxPower: activity.maxPower,
    normalizedPower: activity.normalizedPower,
    trainingLoad: activity.trainingLoad,
    ftp: activity.ftp,
    aerobicTrainingEffect: activity.aerobicTrainingEffect,
    anaerobicTrainingEffect: activity.anaerobicTrainingEffect,
    device: activity.device,
    bikeName: activity.bikeName,
  };
}

/**
 * 将领域 Activity 的逐点记录转换为 activity_records 表实体。
 * 仅保留规格 §18 字段清单的字段（含 activityId），grade 暂不落库。
 *
 * @param activity 领域活动
 */
function toRecordEntities(activity: Activity): ActivityRecordEntity[] {
  return (activity.records ?? []).map((record) => ({
    activityId: activity.id,
    timestamp: record.timestamp,
    latitude: record.latitude,
    longitude: record.longitude,
    altitude: record.altitude,
    distance: record.distance,
    speed: record.speed,
    heartRate: record.heartRate,
    cadence: record.cadence,
    power: record.power,
    temperature: record.temperature,
  }));
}
