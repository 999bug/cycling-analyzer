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
import type { ActivityBlobEntity, ActivityEntity, ActivityRecordEntity, CyclingDatabase } from '@/storage/db';
import { localDateKeyFromIso } from '@/utils/format';
import { normalizeActivityType } from '@/types/activityType';

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
 * 轨迹首尾有效坐标（路线分组用）。
 * 两端均取「首个/最后一个带坐标的记录」，缺坐标的活动视为无端点。
 */
export interface RouteEndpoints {
  /** 起点坐标 */
  start: { latitude: number; longitude: number };

  /** 终点坐标 */
  end: { latitude: number; longitude: number };
}

/**
 * 活动列表查询选项。
 */
export interface ActivityListOptions {
  /**
   * 排序字段（默认 startTime）。
   * 覆盖列表页全部 8 列：名称/时间/距离/时长/爬升/平均速度/平均心率/平均功率。
   */
  sortBy?:
    | 'name'
    | 'startTime'
    | 'distance'
    | 'duration'
    | 'elevationGain'
    | 'avgSpeed'
    | 'avgHeartRate'
    | 'avgPower';

  /** 排序方向（默认 desc） */
  sortOrder?: 'asc' | 'desc';

  /** 分页偏移（默认 0） */
  offset?: number;

  /** 分页条数（默认 20，0 = 不分页） */
  limit?: number;

  /** 年份筛选（本地日期年份，如 2026） */
  year?: string;

  /** 月份筛选（本地日期月份，如 2026-08） */
  month?: string;

  /**
   * 运动类型筛选（传规范类型值，如 cycling / running）。
   * 比对时会归一化库中存储值，因此历史遗留的原始写法（road_biking、骑行）
   * 也能被正确筛出；传 undefined / 空串表示不限制。
   */
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

  /** 最小骑行时长（秒，undefined = 不限制） */
  minDuration?: number;

  /** 最大骑行时长（秒，undefined = 不限制） */
  maxDuration?: number;

  /** 最小平均速度（m/s，undefined = 不限制） */
  minAvgSpeed?: number;

  /** 最大平均速度（m/s，undefined = 不限制） */
  maxAvgSpeed?: number;

  /** 最小平均心率（bpm，undefined = 不限制；心率缺失的活动不满足条件） */
  minAvgHeartRate?: number;

  /** 最大平均心率（bpm，undefined = 不限制；心率缺失的活动不满足条件） */
  maxAvgHeartRate?: number;

  /** 最小平均功率（W，undefined = 不限制；功率缺失的活动不满足条件） */
  minAvgPower?: number;

  /** 最大平均功率（W，undefined = 不限制；功率缺失的活动不满足条件） */
  maxAvgPower?: number;

  /** 起始日期下界（YYYY-MM-DD，按活动本地日期比较，含边界） */
  startTimeFrom?: string;

  /** 结束日期上界（YYYY-MM-DD，按活动本地日期比较，含边界） */
  startTimeTo?: string;
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
   * 批量查询多个活动的逐点记录（全量轨迹扫描类页面用：热力图等）。
   *
   * 单次索引查询替代逐活动串行 getRecords（N 次 IndexedDB 事务 → 1 次），
   * 本地数据量增长时避免首次进入扫描页明显变慢。
   *
   * @param activityIds 活动 ID 列表（空列表返回空 Map）
   * @returns 活动ID → 逐点记录 分组映射
   */
  getRecordsByActivityIds(activityIds: readonly string[]): Promise<Map<string, ActivityRecord[]>>;

  /**
   * 读取活动的路线首尾有效坐标（路线分组 / 相似骑行用）。
   *
   * 优先取摘要上冗余的 route{Start,End}{Latitude,Longitude}；缺失时（旧活动）
   * 回退读取逐点轨迹并写回摘要，使该活动下次起不再加载完整轨迹——
   * 即「首次自愈、后续零轨迹读取」。作者快照实现只读摘要，不做写回。
   *
   * @param activityId 活动 ID
   * @returns 首尾坐标；活动不存在或无有效坐标时 undefined
   */
  getRouteEndpoints(activityId: string): Promise<RouteEndpoints | undefined>;

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
   * 修正单条活动的运动类型（批量修正弹窗用；只改摘要标记，不动逐点数据）。
   *
   * @param id 活动 ID
   * @param activityType 规范运动类型（cycling / running / walking / …）
   */
  updateActivityType(id: string, activityType: string): Promise<void>;

  /**
   * 更新轨迹坐标系 / 来源 / 手动微调（纠偏写操作）。
   *
   * 只改标记与微调量，绝不改写 activity_records 中的原始坐标——
   * 这是「来回切换来源可无限次还原、零误差累积」的前提。
   */
  updateTrackSystem(
    id: string,
    patch: Pick<Activity, 'coordinateSystem' | 'sourceApp' | 'trackOffset'>,
  ): Promise<void>;

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
   * 批量删除活动（单事务级联删除逐点记录）。
   *
   * 性能关键：逐点数据按 activityId 二级索引定位时必须先 primaryKeys()
   * 再 bulkDelete——直接在二级索引 Collection 上调 delete() 会走 Dexie 的
   * modify 回退，逐条游标读取并反序列化全部记录体（单活动数千~数万点），
   * 批量删除时是 N × M 次反序列化，UI 明显卡死。
   *
   * @param ids 活动 ID 列表（空列表直接返回）
   */
  deleteActivities(ids: readonly string[]): Promise<void>;

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
    year,
    activityType,
    search,
    minDistance,
    maxDistance,
    minElevationGain,
    maxElevationGain,
    minDuration,
    maxDuration,
    minAvgSpeed,
    maxAvgSpeed,
    minAvgHeartRate,
    maxAvgHeartRate,
    minAvgPower,
    maxAvgPower,
    startTimeFrom,
    startTimeTo,
  } = options;

  let items = [...all];
  if (year) {
    items = items.filter((a) => localDateKeyFromIso(a.startTime)?.startsWith(String(year)) === true);
  }
  if (month) {
    items = items.filter((a) => localDateKeyFromIso(a.startTime)?.startsWith(month) === true);
  }
  if (activityType) {
    // 按归一化后的类型比对：库里可能存有各平台的原始写法
    // （佳明 road_biking、Strava 中文「骑行」），直接比字面量会漏掉它们
    items = items.filter((a) => normalizeActivityType(a.activityType) === activityType);
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

  // 日期区间筛选（按活动本地日期 YYYY-MM-DD 比较，含边界；自定义筛选日期条件）
  if (startTimeFrom !== undefined) {
    items = items.filter((a) => {
      const dateKey = localDateKeyFromIso(a.startTime);
      return dateKey !== undefined && dateKey >= startTimeFrom;
    });
  }
  if (startTimeTo !== undefined) {
    items = items.filter((a) => {
      const dateKey = localDateKeyFromIso(a.startTime);
      return dateKey !== undefined && dateKey <= startTimeTo;
    });
  }

  // 数值范围筛选（单位与领域模型一致：距离米、时长秒、爬升米、速度 m/s、心率 bpm、功率 W；
  // 含边界，组合为 AND）。可选字段（elevationGain/avgHeartRate/avgPower）缺失的活动
  // 不满足任何对应条件（显式排除 undefined，与既有口径一致：无数据的字段无法参与比较）
  if (minDistance !== undefined) {
    items = items.filter((a) => a.distance >= minDistance);
  }
  if (maxDistance !== undefined) {
    items = items.filter((a) => a.distance <= maxDistance);
  }
  if (minDuration !== undefined) {
    items = items.filter((a) => a.duration >= minDuration);
  }
  if (maxDuration !== undefined) {
    items = items.filter((a) => a.duration <= maxDuration);
  }
  if (minElevationGain !== undefined) {
    items = items.filter((a) => a.elevationGain !== undefined && a.elevationGain >= minElevationGain);
  }
  if (maxElevationGain !== undefined) {
    items = items.filter((a) => a.elevationGain !== undefined && a.elevationGain <= maxElevationGain);
  }
  if (minAvgSpeed !== undefined) {
    items = items.filter((a) => a.avgSpeed !== undefined && a.avgSpeed >= minAvgSpeed);
  }
  if (maxAvgSpeed !== undefined) {
    items = items.filter((a) => a.avgSpeed !== undefined && a.avgSpeed <= maxAvgSpeed);
  }
  if (minAvgHeartRate !== undefined) {
    items = items.filter((a) => a.avgHeartRate !== undefined && a.avgHeartRate >= minAvgHeartRate);
  }
  if (maxAvgHeartRate !== undefined) {
    items = items.filter((a) => a.avgHeartRate !== undefined && a.avgHeartRate <= maxAvgHeartRate);
  }
  if (minAvgPower !== undefined) {
    items = items.filter((a) => a.avgPower !== undefined && a.avgPower >= minAvgPower);
  }
  if (maxAvgPower !== undefined) {
    items = items.filter((a) => a.avgPower !== undefined && a.avgPower <= maxAvgPower);
  }

  // 排序（数字字段按值序，缺失按 0 参与即沉底；字符串字段 startTime/name 按字典序）
  const direction = sortOrder === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    if (sortBy === 'name' || sortBy === 'startTime') {
      const left = sortBy === 'name' ? (a.name ?? '') : a.startTime;
      const right = sortBy === 'name' ? (b.name ?? '') : b.startTime;
      if (left < right) {
        return -direction;
      }
      if (left > right) {
        return direction;
      }
      return 0;
    }
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
    const blob = toBlobEntity(activity);
    await this.db.transaction(
      'rw',
      [this.db.activities, this.db.activity_blobs, this.db.activity_records],
      async () => {
        await this.db.activities.add(entity);
        // 逐点数据整活动一行（v5）：写 1 行大 value，替代旧逐点 bulkAdd
        await this.db.activity_blobs.put(blob);
      },
    );
  }

  async addActivities(activities: Activity[]): Promise<void> {
    const entities = activities.map((activity) => toActivityEntity(activity));
    const blobs = activities.map(toBlobEntity);
    await this.db.transaction(
      'rw',
      [this.db.activities, this.db.activity_blobs, this.db.activity_records],
      async () => {
        if (entities.length > 0) {
          await this.db.activities.bulkAdd(entities);
        }
        // 每活动一行 put：导入写库从 N 行变 N 条大 value（实测快约 400 倍）
        await this.db.activity_blobs.bulkPut(blobs);
      },
    );
  }

  async getById(id: string): Promise<ActivitySummary | undefined> {
    return this.db.activities.get(id);
  }

  async getRouteEndpoints(activityId: string): Promise<RouteEndpoints | undefined> {
    const summary = await this.db.activities.get(activityId);
    if (summary === undefined) {
      return undefined;
    }
    const stored = readRouteEndpoints(summary);
    if (stored !== undefined) {
      return stored;
    }
    // 旧活动：摘要缺冗余端点，读一次轨迹后写回，后续加载不再触碰逐点数据
    const records = await this.getRecords(activityId);
    const extracted = extractRouteEndpoints(records);
    if (extracted !== undefined) {
      await this.db.activities.update(activityId, toRouteEndpointFields(records));
    }
    return extracted;
  }

  async getRecords(activityId: string, options?: RecordQueryOptions): Promise<ActivityRecord[]> {
    const { offset = 0, limit = 0 } = options ?? {};
    // v5 主路径：整活动一行，主键 get 即取全部点
    const blob = await this.db.activity_blobs.get(activityId);
    if (blob !== undefined) {
      return blob.records.slice(offset, limit > 0 ? offset + limit : undefined);
    }
    // 迁移兜底：旧逐点行表仍有数据（后台迁移未完成），按旧路径读并回填新表，
    // 让迁移任务与读取路径双向收敛。旧表无数据时不回填（防已删除活动留孤儿空行，
    // 无 records 的活动由迁移任务补空行）
    const legacy = await this.db.activity_records.where('activityId').equals(activityId).toArray();
    if (legacy.length === 0) {
      return [];
    }
    const records: ActivityRecord[] = legacy.map(stripEntityToRecord);
    await this.db.activity_blobs.put({ activityId, records });
    return records.slice(offset, limit > 0 ? offset + limit : undefined);
  }

  async getRecordsByActivityIds(
    activityIds: readonly string[],
  ): Promise<Map<string, ActivityRecord[]>> {
    const grouped = new Map<string, ActivityRecord[]>();
    if (activityIds.length === 0) {
      return grouped;
    }
    for (const id of activityIds) {
      grouped.set(id, []);
    }
    // v5 主路径：主键批量取整活动行（一次事务）
    const blobs = await this.db.activity_blobs.bulkGet([...activityIds]);
    const missing: string[] = [];
    blobs.forEach((blob, index) => {
      const id = activityIds[index];
      if (blob !== undefined) {
        grouped.set(id, blob.records);
      } else {
        missing.push(id);
      }
    });
    if (missing.length === 0) {
      return grouped;
    }
    // 迁移兜底：未迁移的活动从旧逐点行表聚合（单次 anyOf 索引查询）并回填新表
    const legacy = await this.db.activity_records
      .where('activityId')
      .anyOf(missing)
      .toArray();
    for (const id of missing) {
      grouped.set(id, []);
    }
    for (const record of legacy) {
      const bucket = grouped.get(record.activityId);
      if (bucket !== undefined) {
        bucket.push(stripEntityToRecord(record));
      }
    }
    const backfill = missing
      .map((id) => ({
        activityId: id,
        records: grouped.get(id) ?? [],
      }))
      .filter((blob) => blob.records.length > 0);
    if (backfill.length > 0) {
      await this.db.activity_blobs.bulkPut(backfill);
    }
    return grouped;
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

  /**
   * 修正单条活动的运动类型（批量修正弹窗用）。
   *
   * 只改摘要上的类型标记：逐点数据与距离/时长等度量不受影响，
   * 影响面仅限骑行语义页面是否计入该活动（见 features/activity/cyclingScope）。
   *
   * @param id 活动 ID
   * @param activityType 规范运动类型
   */
  async updateActivityType(id: string, activityType: string): Promise<void> {
    await this.db.activities.update(id, { activityType });
  }

  async updateNormalizedPower(id: string, normalizedPower: number): Promise<void> {
    await this.db.activities.update(id, { normalizedPower });
  }

  async updateTrackSystem(
    id: string,
    patch: Pick<Activity, 'coordinateSystem' | 'sourceApp' | 'trackOffset'>,
  ): Promise<void> {
    // 纠偏只改摘要上的标记：逐点数据保持导入时的原始坐标不变
    await this.db.activities.update(id, patch);
  }

  async deleteActivity(id: string): Promise<void> {
    await this.deleteActivities([id]);
  }

  async deleteActivities(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.db.transaction(
      'rw',
      [this.db.activities, this.db.activity_blobs, this.db.activity_records],
      async () => {
        // v5 主路径：两个主键表 bulkDelete，每活动各删 1 行，毫秒级
        await this.db.activities.bulkDelete([...ids]);
        await this.db.activity_blobs.bulkDelete([...ids]);
        // 迁移兜底：旧逐点行表残留数据一并清理（迁移完成后此表为空，空操作）。
        // 先取主键再 bulkDelete，跳过 Dexie 二级索引 delete() 的 modify 回退
        const legacyKeys = await this.db.activity_records
          .where('activityId')
          .anyOf([...ids])
          .primaryKeys();
        if (legacyKeys.length > 0) {
          await this.db.activity_records.bulkDelete(legacyKeys);
        }
      },
    );
  }

  async deleteAll(): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.activities, this.db.activity_blobs, this.db.activity_records],
      async () => {
        await this.db.activities.clear();
        await this.db.activity_blobs.clear();
        await this.db.activity_records.clear();
      },
    );
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
      // 无海拔数据源（行者 GPX）爬升为 undefined：聚合按 0 参与
      summary.totalElevationGain += activity.elevationGain ?? 0;
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
    coordinateSystem: activity.coordinateSystem,
    sourceApp: activity.sourceApp,
    trackOffset: activity.trackOffset,
    ...toRouteEndpointFields(activity.records),
  };
}

/** 提取并持久化首尾有效坐标，避免路线分组为读取端点加载完整轨迹。 */
function toRouteEndpointFields(records: ActivityRecord[] | undefined): Pick<
  ActivityEntity,
  'routeStartLatitude' | 'routeStartLongitude' | 'routeEndLatitude' | 'routeEndLongitude'
> {
  const endpoints = extractRouteEndpoints(records ?? []);
  return {
    routeStartLatitude: endpoints?.start.latitude,
    routeStartLongitude: endpoints?.start.longitude,
    routeEndLatitude: endpoints?.end.latitude,
    routeEndLongitude: endpoints?.end.longitude,
  };
}

/**
 * 从逐点数据提取首尾有效坐标（跳过无坐标的记录点）。
 *
 * @param records 逐点记录（按时间升序）
 * @returns 首尾坐标；无任何坐标点返回 undefined
 */
function extractRouteEndpoints(records: readonly ActivityRecord[]): RouteEndpoints | undefined {
  let start: RouteEndpoints['start'] | undefined;
  let end: RouteEndpoints['end'] | undefined;
  for (const record of records) {
    if (record.latitude === undefined || record.longitude === undefined) {
      continue;
    }
    const point = { latitude: record.latitude, longitude: record.longitude };
    if (start === undefined) {
      start = point;
    }
    end = point;
  }
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return { start, end };
}

/**
 * 从活动摘要读取冗余的首尾坐标（四个字段齐全才算有效）。
 *
 * @param summary 活动摘要
 * @returns 首尾坐标；字段缺失返回 undefined
 */
export function readRouteEndpoints(summary: ActivityEntity): RouteEndpoints | undefined {
  const { routeStartLatitude, routeStartLongitude, routeEndLatitude, routeEndLongitude } = summary;
  if (
    routeStartLatitude === undefined ||
    routeStartLongitude === undefined ||
    routeEndLatitude === undefined ||
    routeEndLongitude === undefined
  ) {
    return undefined;
  }
  return {
    start: { latitude: routeStartLatitude, longitude: routeStartLongitude },
    end: { latitude: routeEndLatitude, longitude: routeEndLongitude },
  };
}

/**
 * 将领域 Activity 的逐点记录转换为整活动一行实体（v5 activity_blobs）。
 * 仅保留规格 §18 字段清单的字段，grade 暂不落库。
 *
 * @param activity 领域活动
 */
function toBlobEntity(activity: Activity): ActivityBlobEntity {
  const records: ActivityRecord[] = (activity.records ?? []).map((record) => ({
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
  return { activityId: activity.id, records };
}

/**
 * 旧逐点行实体剥壳为领域记录（迁移兜底读旧表时使用）。
 *
 * @param entity 旧 activity_records 行
 */
function stripEntityToRecord(entity: ActivityRecordEntity): ActivityRecord {
  return {
    timestamp: entity.timestamp,
    latitude: entity.latitude,
    longitude: entity.longitude,
    altitude: entity.altitude,
    distance: entity.distance,
    speed: entity.speed,
    heartRate: entity.heartRate,
    cadence: entity.cadence,
    power: entity.power,
    temperature: entity.temperature,
  };
}
