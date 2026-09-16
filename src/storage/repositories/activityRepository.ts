/**
 * 活动仓库（activities + activity_chunks 表，规格 §18）。
 *
 * 职责：活动摘要与逐点数据的增删查、列表查询（排序/分页/筛选/搜索）、
 * 时间范围统计聚合。重复检测通过 fingerprint 唯一索引 + existsByFingerprint 完成。
 *
 * 逐点数据的存储布局由本模块内部封装（v9 起为 activity_chunks 分片；v5~v8 的
 * activity_blobs 整活动行与更早的 activity_records 逐点行表仅作迁移兜底读取）。
 * 对外契约始终是 `ActivityRecord[]`——布局变化不溢出到调用方。
 *
 * 说明：筛选与排序的**语义**始终由内存纯函数 `queryActivityList` 定义（作为
 * 最终一致性基准 / oracle），索引只负责缩小候选集：无筛选的按时间分页走
 * startTime 索引游标，年/月筛选走 localDate 索引。数值区间组合无法用索引表达，
 * 一律内存精筛——这样「走不走索引」只影响性能，不影响结果。
 */
import type { Activity, ActivityRecord } from '@/types/activity';
import type {
  ActivityChunkEntity,
  ActivityEntity,
  ActivityRecordEntity,
  CyclingDatabase,
} from '@/storage/db';
import { chunkSeqRange, sliceChunks, toChunkEntities } from '@/storage/activityChunks';
import { clearSegmentScanState, pruneSegmentScanState } from '@/storage/segmentScanState';
import { isLocalDateIndexReady } from '@/storage/localDateBackfill';
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
 * 分批流式读取选项。
 */
export interface RecordBatchOptions {
  /** 每批活动数（缺省 DEFAULT_RECORD_BATCH_SIZE） */
  batchSize?: number;

  /** 进度回调（每批一次，参数为已处理活动数与总数） */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 分批流式读取的默认批大小。
 *
 * 取 16 的依据：典型活动 2000~10000 点，16 个活动约 3.2 万~16 万点
 * （按实测单点 ≈ 161.5 B 估算约 5~26MB），相比「全部活动一次驻留」
 * （500 活动 × 2000 点 = 154MB）已降一个数量级；再调小会让批次数与
 * 索引事务数明显上升（赛段场景还要按批往返 Worker）。
 */
export const DEFAULT_RECORD_BATCH_SIZE = 16;

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
   * 分页是**真分页**：v9 起逐点数据分片存放，实现只解出覆盖目标区间的片。
   * 调用方无需感知布局，但需注意 `offset` 过大时索引游标仍要遍历前置条目
   * （解出的对象数不变，只是遍历时间略增）。
   *
   * @param activityId 活动 ID
   * @param options 分页选项（limit 为 0 或省略 = 取全部）
   * @returns 逐点记录（按存储序返回）
   */
  getRecords(activityId: string, options?: RecordQueryOptions): Promise<ActivityRecord[]>;

  /**
   * 批量查询多个活动的逐点记录（全量轨迹扫描类页面用：热力图等）。
   *
   * 单次索引查询替代逐活动串行 getRecords（N 次 IndexedDB 事务 → 1 次），
   * 本地数据量增长时避免首次进入扫描页明显变慢。
   *
   * ⚠️ 返回值是**全量**记录：调用方的峰值内存约为「所有活动逐点数据之和」。
   * 千级活动 × 万级点数的场景应改用分批流式读取（见 P1-3），本方法保留给
   * 小规模或确定性已知的场景。Map 的迭代序 = 入参 id 的顺序。
   *
   * @param activityIds 活动 ID 列表（空列表返回空 Map）
   * @returns 活动ID → 逐点记录 分组映射
   */
  getRecordsByActivityIds(activityIds: readonly string[]): Promise<Map<string, ActivityRecord[]>>;

  /**
   * 分批流式读取多个活动的逐点记录（全量轨迹扫描类页面的**首选**方式）。
   *
   * 与 `getRecordsByActivityIds` 的唯一区别是**峰值内存**：后者返回
   * `Map<活动, 全量记录>`，峰值 = 所有活动逐点之和（实测 500 活动 × 2000 点
   * = 154MB，iOS 上必被杀）；本方法每批只驻留 `batchSize` 个活动的记录，
   * 回调返回后即可被回收。
   *
   * 回调**串行**调用（不并发），因此调用方可以安全地在回调里做重计算、
   * 提交给 Web Worker 或累加结果——但**不得**把 batch 里的记录长期持有，
   * 否则退化回全量驻留。
   *
   * 顺序保证：批内 Map 的迭代序 = 入参顺序；跨批顺序 = 入参顺序。
   * 返回值 `false` 表示提前结束遍历（页面卸载等的短路用）。
   *
   * @param activityIds 活动 ID 列表（空列表不触发任何回调）
   * @param visit 批回调（返回 false 时停止遍历）
   * @param options 批大小与进度回调
   */
  iterateRecordBatches(
    activityIds: readonly string[],
    visit: (batch: ReadonlyMap<string, ActivityRecord[]>) => void | boolean | Promise<void | boolean>,
    options?: RecordBatchOptions,
  ): Promise<void>;

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
/**
 * 随活动一并落库的文件台账条目。
 *
 * 与活动摘要**同事务**写入：分开写时「活动写成功、台账写失败」会留下一个
 * 进了 activities 却没进 files 台账的活动——判重走指纹、失败重试走台账，
 * 两边不一致时用户会看到「导入成功但重试不了」。
 */
export interface ActivityFileRecord {
  /** 内容指纹（files 表主键） */
  fingerprint: string;

  /** 原始文件名 */
  fileName: string;

  /** 解压后字节数 */
  fileSize: number;

  /** 原始文件字节（仅开启「保存原始 FIT 文件」时提供） */
  data?: ArrayBuffer;
}

export interface ActivityRepository extends ActivityReadRepository {
  /**
   * 写入单个活动（摘要 + 逐点记录，事务保证原子性）。
   * fingerprint 重复时抛出 ConstraintError，调用方应先 existsByFingerprint 检测。
   *
   * @param activity 活动（records 可选，为 undefined 时不写逐点表）
   * @param name 活动标题（Strava CSV 还原，可为空）
   * @param file 文件台账条目（传入时与摘要同事务落库，见 ActivityFileRecord）
   */
  addActivity(activity: Activity, name?: string, file?: ActivityFileRecord): Promise<void>;

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
   * 修正运动类型并标记「用户已确认」（批量修正弹窗应用时调用）。
   *
   * 与 `updateActivityType` 的区别只在多写一个 `typeConfirmedAt` 时间戳：
   * 类型复核检测据此跳过该记录，避免灰区记录（库里仍记为 cycling、速度特征
   * 又落在重叠区）每次进列表都被重新提示。用户未确认的记录不受影响。
   *
   * @param id 活动 ID
   * @param activityType 规范运动类型
   */
  confirmActivityType(id: string, activityType: string): Promise<void>;

  /**
   * 清空全部活动的类型确认标记（设置页「重置类型提示」）。
   *
   * 标记删除后类型复核检测会重新提示这些记录——作为用户改错了的后悔药。
   *
   * @returns 被清除标记的活动条数
   */
  clearTypeConfirmations(): Promise<number>;

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
 * 活动本地日期键（YYYY-MM-DD）。
 *
 * 优先取摘要上已存的 `localDate`（v8 索引字段，写入/回填时算好）：它与
 * `localDate` 索引路径**同源**，避免出现「索引按存储值筛、内存按当前时区重算」
 * 在用户跨时区后给出不同结果——同一份数据必须只有一个答案。
 *
 * 旧数据（未回填）与作者快照没有该字段，回退按 `startTime` 现算。
 * 注：快照**刻意不写** localDate——那个值会在 CI 机器的时区下算出来，
 * 与访问者本地时区不符，反而会污染年/月筛选口径。
 *
 * @param activity 活动摘要
 * @returns 本地日期键，无法计算时 undefined
 */
function localDateKeyOf(activity: ActivitySummary): string | undefined {
  return activity.localDate ?? localDateKeyFromIso(activity.startTime);
}

/**
 * 活动列表内存查询（筛选/排序/分页）。
 * Dexie 与作者快照两个仓库实现共用本函数，保证任一数据源行为一致
 * （个人数据量级小，全量过滤 + 内存排序保证多条件组合正确）。
 *
 * 本函数同时是索引路径的 **oracle**：索引只缩候选集，最终结果一律由这里定义，
 * 因此「走不走索引」不影响返回内容。
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
    items = items.filter((a) => localDateKeyOf(a)?.startsWith(String(year)) === true);
  }
  if (month) {
    items = items.filter((a) => localDateKeyOf(a)?.startsWith(month) === true);
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
      const dateKey = localDateKeyOf(a);
      return dateKey !== undefined && dateKey >= startTimeFrom;
    });
  }
  if (startTimeTo !== undefined) {
    items = items.filter((a) => {
      const dateKey = localDateKeyOf(a);
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
    let compared = 0;
    if (sortBy === 'name' || sortBy === 'startTime') {
      const left = sortBy === 'name' ? (a.name ?? '') : a.startTime;
      const right = sortBy === 'name' ? (b.name ?? '') : b.startTime;
      if (left < right) {
        compared = -direction;
      } else if (left > right) {
        compared = direction;
      }
    } else {
      const left = a[sortBy] ?? 0;
      const right = b[sortBy] ?? 0;
      if (left < right) {
        compared = -direction;
      } else if (left > right) {
        compared = direction;
      }
    }
    if (compared !== 0) {
      return compared;
    }
    // 同值兜底按 id 比较，方向与主排序一致：与 IndexedDB 索引扫描的次序
    // （键升序、同键按主键升序；倒序扫描时两者同时倒序）对齐，使「索引快路径」
    // 与「内存 oracle」在存在同值行时仍返回同一结果——一致性测试才有意义。
    // 不补这层兜底，排序结果依赖实现路径，测试会随机飘。
    if (a.id === b.id) {
      return 0;
    }
    return a.id < b.id ? -direction : direction;
  });

  const total = items.length;
  const page = limit > 0 ? items.slice(offset, offset + limit) : items.slice(offset);
  return { items: page, total };
}

/** 无法用索引表达的数值区间筛选字段 */
const NUMERIC_FILTER_KEYS = [
  'minDistance',
  'maxDistance',
  'minElevationGain',
  'maxElevationGain',
  'minDuration',
  'maxDuration',
  'minAvgSpeed',
  'maxAvgSpeed',
  'minAvgHeartRate',
  'maxAvgHeartRate',
  'minAvgPower',
  'maxAvgPower',
] as const satisfies readonly (keyof ActivityListOptions)[];

/** 列表查询的执行策略 */
export type ActivityQueryStrategy =
  /** 无筛选 + 按 startTime 排序 + 分页：由索引游标直接取当前页（不 materialize 全量） */
  | 'index-startTime'
  /** 年/月筛选且 localDate 索引就绪：只取该年/月的候选集，再内存精筛 */
  | 'index-localDate'
  /** 全量读出后内存精筛（正确性由 queryActivityList 保证） */
  | 'full-scan';

/** 查询规划所需的能力状态 */
export interface ActivityQueryContext {
  /** localDate 索引是否已就绪（未就绪时不得走 localDate 路径，否则漏掉未回填的行） */
  localDateIndexReady: boolean;
}

/**
 * 是否存在「索引无法表达」的筛选条件。
 *
 * 数值区间筛选有 12 个字段、任意组合，建索引也覆盖不了
 * `minDistance AND maxElevationGain AND minAvgPower` 这类组合，选择性通常也低——
 * 所以索引只做「缩候选集」的预筛，精筛仍在内存。这是刻意取舍，不是遗漏。
 *
 * 空值判定与 `queryActivityList` 保持同口径（空串/纯空白不算筛选条件），
 * 否则会出现「规划器认为无筛选走快路径、oracle 认为有筛选」的错配。
 *
 * @param options 查询选项
 * @returns 是否存在只能内存精筛的条件
 */
function hasInMemoryOnlyFilters(options: ActivityListOptions): boolean {
  if (NUMERIC_FILTER_KEYS.some((key) => options[key] !== undefined)) {
    return true;
  }
  if (options.startTimeFrom !== undefined || options.startTimeTo !== undefined) {
    return true;
  }
  if (options.activityType !== undefined && options.activityType !== '') {
    return true;
  }
  if (options.search !== undefined && options.search.trim() !== '') {
    return true;
  }
  return false;
}

/**
 * 年/月筛选的日期前缀（month 优先：`2026-08` 的前缀已隐含年份）。
 *
 * @param options 查询选项
 * @returns 日期前缀，无年/月筛选时 undefined
 */
function datePrefixOf(options: ActivityListOptions): string | undefined {
  if (options.month !== undefined && options.month !== '') {
    return options.month;
  }
  if (options.year !== undefined && options.year !== '') {
    return options.year;
  }
  return undefined;
}

/**
 * 列表查询规划：决定走索引快路径还是全量精筛。
 *
 * 拆成纯函数是为了可单测（不需要真 IndexedDB 就能覆盖全部分支），
 * 也让「哪些查询真的走了索引」这件事有单一出处、可被评审。
 *
 * @param options 查询选项
 * @param context 能力状态（localDate 索引是否就绪）
 * @returns 执行策略
 */
export function planActivityQuery(
  options: ActivityListOptions,
  context: ActivityQueryContext,
): ActivityQueryStrategy {
  const { sortBy = DEFAULT_SORT_BY, limit = DEFAULT_PAGE_SIZE } = options;
  const datePrefix = datePrefixOf(options);

  // ① 无任何筛选 + 按 startTime 排序 + 分页请求：排序字段与索引同序，
  //    直接让 IndexedDB 走索引游标跳页，只读当前页（真正的分页，非假分页）
  if (
    sortBy === DEFAULT_SORT_BY &&
    limit > 0 &&
    datePrefix === undefined &&
    !hasInMemoryOnlyFilters(options)
  ) {
    return 'index-startTime';
  }
  // ② 年/月筛选且索引就绪：先按本地日期前缀缩到大半年份的候选集
  if (datePrefix !== undefined && context.localDateIndexReady) {
    return 'index-localDate';
  }
  // ③ 其余组合：全量读出后内存精筛
  return 'full-scan';
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

  async addActivity(activity: Activity, name?: string, file?: ActivityFileRecord): Promise<void> {
    const entity = toActivityEntity(activity, name);
    const chunks = toChunkEntities(activity.id, activity.records ?? []);
    await this.db.transaction(
      'rw',
      [this.db.activities, this.db.activity_chunks, this.db.files],
      async () => {
        await this.db.activities.add(entity);
        // 逐点数据按片写入（v9）：读取时可按区间只取需要的片。
        // 无记录的活动不写任何片——读取路径对「无片」会依次回退到旧表，
        // 最终语义同样是空数组，不必写占位行
        if (chunks.length > 0) {
          await this.db.activity_chunks.bulkPut(chunks);
        }
        // 台账同事务：与摘要同生同灭，避免「活动在、台账不在」的孤儿状态
        if (file !== undefined) {
          await this.db.files.put({
            fingerprint: file.fingerprint,
            fileName: file.fileName,
            fileSize: file.fileSize,
            importedAt: new Date().toISOString(),
            status: 'imported',
            // 仅开启「保存原始 FIT 文件」时传入；undefined 不写入该字段
            ...(file.data !== undefined ? { data: file.data } : {}),
          });
        }
      },
    );
  }

  async addActivities(activities: Activity[]): Promise<void> {
    const entities = activities.map((activity) => toActivityEntity(activity));
    const chunks = activities.flatMap((activity) =>
      toChunkEntities(activity.id, activity.records ?? []),
    );
    await this.db.transaction('rw', [this.db.activities, this.db.activity_chunks], async () => {
      if (entities.length > 0) {
        await this.db.activities.bulkAdd(entities);
      }
      if (chunks.length > 0) {
        await this.db.activity_chunks.bulkPut(chunks);
      }
    });
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
    // v9 主路径：按 [activityId+seq] 复合主键做范围查询，只解出覆盖目标区间的片。
    // 旧实现（v5 整活动一行）取 100 点也要把全部点解出来：实测 10 万点活动
    // 一次 get 就是 15.4MB 的结构化克隆，按批读取时还会成倍放大
    const { startSeq, endSeq } = chunkSeqRange(offset, limit);
    const chunks = await this.db.activity_chunks
      .where('[activityId+seq]')
      .between([activityId, startSeq], [activityId, endSeq], true, true)
      .toArray();
    if (chunks.length > 0) {
      return sliceChunks(chunks, offset, limit);
    }
    // 迁移兜底 ①：v5~v8 的整活动行仍在（后台分片迁移尚未跑到该活动）
    const blob = await this.db.activity_blobs.get(activityId);
    if (blob !== undefined) {
      return blob.records.slice(offset, limit > 0 ? offset + limit : undefined);
    }
    // 迁移兜底 ②：更早的 v4 逐点行表（v4→v5 迁移也未完成）。读到后按**当前**布局
    // 回填分片，让迁移任务与读取路径双向收敛。旧表无数据时不回填（防已删除活动留孤儿行，
    // 真无逐点数据由迁移任务负责推进，不由读路径造行）
    const legacy = await this.db.activity_records.where('activityId').equals(activityId).toArray();
    if (legacy.length === 0) {
      return [];
    }
    const records: ActivityRecord[] = legacy.map(stripEntityToRecord);
    await this.backfillChunks(activityId, records);
    return records.slice(offset, limit > 0 ? offset + limit : undefined);
  }

  async getRecordsByActivityIds(
    activityIds: readonly string[],
  ): Promise<Map<string, ActivityRecord[]>> {
    const grouped = new Map<string, ActivityRecord[]>();
    if (activityIds.length === 0) {
      return grouped;
    }
    // 先按入参顺序建键：Map 迭代序 = 入参序，调用方依赖这一点做稳定的输出顺序
    // （成绩榜同用时长的并列名次、路线绘制层级都取决于活动顺序）
    for (const id of activityIds) {
      grouped.set(id, []);
    }

    // v9 主路径：单次 activityId 索引查询取回全部相关分片
    const found = new Set<string>();
    const chunks = await this.db.activity_chunks
      .where('activityId')
      .anyOf([...activityIds])
      .toArray();
    if (chunks.length > 0) {
      const byActivity = new Map<string, ActivityChunkEntity[]>();
      for (const chunk of chunks) {
        found.add(chunk.activityId);
        const bucket = byActivity.get(chunk.activityId);
        if (bucket === undefined) {
          byActivity.set(chunk.activityId, [chunk]);
        } else {
          bucket.push(chunk);
        }
      }
      for (const [id, list] of byActivity) {
        // 索引同键下按主键序返回（即片序升序），这里显式排序以免依赖实现细节
        list.sort((a, b) => a.seq - b.seq);
        const target = grouped.get(id);
        if (target === undefined) {
          continue;
        }
        for (const chunk of list) {
          for (const record of chunk.records) {
            target.push(record);
          }
        }
      }
    }

    // 迁移兜底 ①：未命中的活动从 v5 整活动行取（单次批量事务）
    const remaining = activityIds.filter((id) => !found.has(id));
    if (remaining.length === 0) {
      return grouped;
    }
    const blobs = await this.db.activity_blobs.bulkGet([...remaining]);
    const stillMissing: string[] = [];
    blobs.forEach((blob, index) => {
      const id = remaining[index];
      if (blob === undefined) {
        stillMissing.push(id);
      } else {
        grouped.set(id, [...blob.records]);
      }
    });
    if (stillMissing.length === 0) {
      return grouped;
    }

    // 迁移兜底 ②：仍未命中的从 v4 逐点行表聚合（单次 anyOf 索引查询）并按当前布局回填
    const legacy = await this.db.activity_records.where('activityId').anyOf(stillMissing).toArray();
    const legacyByActivity = new Map<string, ActivityRecord[]>();
    for (const entity of legacy) {
      const bucket = legacyByActivity.get(entity.activityId);
      if (bucket === undefined) {
        legacyByActivity.set(entity.activityId, [stripEntityToRecord(entity)]);
      } else {
        bucket.push(stripEntityToRecord(entity));
      }
    }
    const backfill: ActivityChunkEntity[] = [];
    for (const id of stillMissing) {
      const records = legacyByActivity.get(id) ?? [];
      grouped.set(id, records);
      // 空记录不回填（防已删除活动留孤儿空行）
      if (records.length > 0) {
        backfill.push(...toChunkEntities(id, records));
      }
    }
    if (backfill.length > 0) {
      await this.db.activity_chunks.bulkPut(backfill);
    }
    return grouped;
  }

  async iterateRecordBatches(
    activityIds: readonly string[],
    visit: (
      batch: ReadonlyMap<string, ActivityRecord[]>,
    ) => void | boolean | Promise<void | boolean>,
    options?: RecordBatchOptions,
  ): Promise<void> {
    const total = activityIds.length;
    if (total === 0) {
      return;
    }
    const requested = options?.batchSize ?? DEFAULT_RECORD_BATCH_SIZE;
    // batchSize <= 0 视为一批到底（调用方明确不要分批）
    const batchSize = requested > 0 ? requested : total;
    for (let offset = 0; offset < total; offset += batchSize) {
      const slice = activityIds.slice(offset, offset + batchSize);
      // 复用 getRecordsByActivityIds：批内仍是一次索引查询，且沿用同一套兜底链
      const batch = await this.getRecordsByActivityIds(slice);
      const keepGoing = await visit(batch);
      options?.onProgress?.(Math.min(offset + batchSize, total), total);
      if (keepGoing === false) {
        return;
      }
    }
  }

  /**
   * 把逐点记录按当前布局（v9 分片）回填，供读取兜底路径收敛用。
   *
   * 空记录不写：写 0 片与不写等价，而留下孤儿行会让后续判断复杂化。
   *
   * @param activityId 活动 ID
   * @param records 逐点记录
   */
  private async backfillChunks(
    activityId: string,
    records: readonly ActivityRecord[],
  ): Promise<void> {
    const chunks = toChunkEntities(activityId, records);
    if (chunks.length > 0) {
      await this.db.activity_chunks.bulkPut(chunks);
    }
  }

  async listActivities(options?: ActivityListOptions): Promise<ActivityListResult> {
    const opts = options ?? {};
    const strategy = planActivityQuery(opts, {
      localDateIndexReady: await isLocalDateIndexReady(this.db),
    });

    if (strategy === 'index-startTime') {
      // 旧实现是 toArray() 取全量再内存排序切片：分页不减少任何 IO，
      // 活动上千后首屏线性劣化。无筛选时排序字段与索引同序，
      // 交给 IndexedDB 游标跳页，只读当前页。
      const {
        sortOrder = DEFAULT_SORT_ORDER,
        offset = 0,
        limit = DEFAULT_PAGE_SIZE,
      } = opts;
      const total = await this.db.activities.count();
      const ordered = this.db.activities.orderBy('startTime');
      const items = await (sortOrder === 'asc' ? ordered : ordered.reverse())
        .offset(offset)
        .limit(limit)
        .toArray();
      return { items, total };
    }

    const candidates =
      strategy === 'index-localDate'
        ? await this.yearMonthCandidates(opts)
        : await this.db.activities.toArray();
    // 候选集可能是命中集的超集，精确筛选与排序仍交给 oracle：
    // 索引只优化性能，语义永远以 queryActivityList 为准
    return queryActivityList(candidates, opts);
  }

  /**
   * 用 localDate 索引取年/月候选集。
   *
   * 返回的是命中集的**超集**（例如 month 前缀筛选时 year 条件尚未应用），
   * 精确筛选由调用方的内存精筛完成。
   *
   * @param options 查询选项（需含 year 或 month）
   * @returns 候选活动摘要
   */
  private async yearMonthCandidates(options: ActivityListOptions): Promise<ActivitySummary[]> {
    const prefix = datePrefixOf(options);
    if (prefix === undefined) {
      return this.db.activities.toArray();
    }
    return this.db.activities.where('localDate').startsWith(prefix).toArray();
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

  /**
   * 修正运动类型并标记用户已确认（时间戳为 Unix 秒）。
   *
   * 标记只影响类型复核检测是否再提示该记录，不参与任何统计口径。
   * 注：typeConfirmedAt 是非索引字段（db.ts 注释），无需升 DB_VERSION。
   */
  async confirmActivityType(id: string, activityType: string): Promise<void> {
    await this.db.activities.update(id, {
      activityType,
      typeConfirmedAt: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * 清空全部类型确认标记，返回被清除的活动条数。
   *
   * typeConfirmedAt 无索引（免升版本），故不能在 where() 上做区间查询，
   * 用全表 filter 收集后按主键批量 update。
   */
  async clearTypeConfirmations(): Promise<number> {
    const confirmed = await this.db.activities.filter((row) => row.typeConfirmedAt !== undefined).toArray()
    if (confirmed.length === 0) {
      return 0
    }
    // 单事务内批量清理：旧实现每条一次独立事务（N 次往返），确认过类型的活动
    // 一多，设置页点一次「清除确认」就要等 N 个事务排队
    await this.db.transaction('rw', this.db.activities, async () => {
      for (const row of confirmed) {
        // 用 modify + delete 真正移除字段（update 传 undefined 会留下空键）
        await this.db.activities.where(':id').equals(row.id).modify((entity) => {
          delete entity.typeConfirmedAt
        })
      }
    })
    return confirmed.length
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
      [
        this.db.activities,
        this.db.activity_chunks,
        this.db.activity_blobs,
        this.db.activity_records,
        this.db.segment_efforts,
      ],
      async () => {
        await this.db.activities.bulkDelete([...ids]);
        // v9 主路径：分片按 activityId 索引取主键再批量删。IndexedDB 没有
        // 「按索引范围删除」的 API，必须两趟（先取键、再 bulkDelete）——
        // 直接 delete(activityId) 会退化成逐行 modify，失去批量语义
        const chunkKeys = await this.db.activity_chunks
          .where('activityId')
          .anyOf([...ids])
          .primaryKeys();
        if (chunkKeys.length > 0) {
          await this.db.activity_chunks.bulkDelete(chunkKeys);
        }
        // 迁移兜底 ①：v5~v8 的整活动行（每活动 1 行主键删除）
        await this.db.activity_blobs.bulkDelete([...ids]);
        // 赛段成绩级联清理（v6）：活动没了成绩无意义，按 activityId 索引删除
        const effortIds = await this.db.segment_efforts
          .where('activityId')
          .anyOf([...ids])
          .primaryKeys();
        if (effortIds.length > 0) {
          await this.db.segment_efforts.bulkDelete(effortIds);
        }
        // 迁移兜底 ②：更早的 v4 逐点行表残留数据一并清理（迁移完成后此表为空，空操作）。
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
    // 扫描状态同步剔除：否则同一活动重新导入时会被判成「无需扫描」，
    // 而它的赛段成绩已在上面级联删除，永远补不回来
    await pruneSegmentScanState([...ids]).catch((error: unknown) => {
      console.error('Failed to prune segment scan state', error);
    });
  }

  async deleteAll(): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.activities,
        this.db.activity_chunks,
        this.db.activity_blobs,
        this.db.activity_records,
        this.db.segment_efforts,
      ],
      async () => {
        await this.db.activities.clear();
        await this.db.activity_chunks.clear();
        await this.db.activity_blobs.clear();
        await this.db.activity_records.clear();
        // 赛段成绩一并清空（本地活动全没了，成绩自然不成立；赛段定义保留）
        await this.db.segment_efforts.clear();
      },
    );
    // 活动集合已清空：扫描状态一并复位，避免后续导入被判成「无需扫描」
    await clearSegmentScanState().catch((error: unknown) => {
      console.error('Failed to clear segment scan state', error);
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
    // 本地日期键（v8 索引字段）：写入时顺带算好，供年/月筛选走索引；
    // startTime 非法时无法算，留空（该行也不会被年/月筛选命中，与 oracle 口径一致）
    localDate: localDateKeyFromIso(activity.startTime),
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
