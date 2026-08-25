/**
 * IndexedDB 数据库定义（规格 §18）。
 *
 * 库名 cycling-data，version 1，共四张表：
 * - activities：活动摘要（不存 records/route，大数据拆表避免单条记录过大）
 * - activity_records：逐点数据，按 activityId 关联活动
 * - files：导入文件状态台账（重复检测、失败记录）
 * - settings：键值对设置
 *
 * 单位约定与领域模型一致（src/types/activity.ts，规格 §11）：
 * 距离米、速度 m/s、海拔米、心率 bpm、踏频 rpm、功率 W。
 */
import Dexie, { type EntityTable } from 'dexie';
import type { ActivityRecord, DeviceInfo } from '@/types/activity';

/** 数据库名称 */
export const DB_NAME = 'cycling-data';

/** 数据库版本号（v2：新增 segments 赛段表；v3：新增 tile_cache 瓦片缓存表） */
export const DB_VERSION = 4;

/**
 * 活动摘要实体（activities 表）。
 * 对应 Activity 的全部摘要字段 + name（活动标题，规格 §31 Strava CSV 还原），
 * 不含 records 与 route（大数据拆表到 activity_records，规格 §18）。
 */
export interface ActivityEntity {
  /** 活动唯一标识（导入时生成） */
  id: string;

  /** 活动标题（Strava CSV 还原，可为空） */
  name?: string;

  /** 活动描述（Strava CSV 还原，可为空；非索引字段，免升版本） */
  description?: string;

  /** 个人备注（本地导入时手动填写，与 Strava 描述分开；非索引字段，免升版本） */
  note?: string;

  /** 源 FIT 文件标识 */
  fileId: string;

  /** 源文件名 */
  fileName: string;

  /** 文件内容指纹（SHA-256），唯一索引用于重复检测（规格 §9） */
  fingerprint: string;

  /** 运动类型（如 cycling / running） */
  activityType: string;

  /** 开始时间（ISO 8601，索引字段） */
  startTime: string;

  /** 结束时间（ISO 8601） */
  endTime: string;

  /** 骑行计时时长（秒） */
  duration: number;

  /** 总耗时（秒，含暂停） */
  elapsedTime: number;

  /** 总距离（米） */
  distance: number;

  /** 累计爬升（米） */
  elevationGain: number;

  /** 累计下降（米） */
  elevationLoss?: number;

  /** 消耗卡路里（千卡） */
  calories?: number;

  /** 平均速度（m/s） */
  avgSpeed?: number;

  /** 最高速度（m/s） */
  maxSpeed?: number;

  /** 平均心率（bpm） */
  avgHeartRate?: number;

  /** 最高心率（bpm） */
  maxHeartRate?: number;

  /** 平均踏频（rpm） */
  avgCadence?: number;

  /** 最高踏频（rpm） */
  maxCadence?: number;

  /** 平均功率（W） */
  avgPower?: number;

  /** 最高功率（W） */
  maxPower?: number;

  /** 标准化功率（W，后续版本计算） */
  normalizedPower?: number;

  /** 训练负荷（TSS，后续版本计算） */
  trainingLoad?: number;

  /** 功能阈值功率（W，后续版本计算） */
  ftp?: number;

  /** 有氧训练效果（0-5，设备 session 提供） */
  aerobicTrainingEffect?: number;

  /** 无氧训练效果（0-5，设备 session 提供） */
  anaerobicTrainingEffect?: number;

  /** 设备信息 */
  device?: DeviceInfo;

  /** 自行车名称（FIT session sport_profile_name，骑行设备所选单车；非索引字段，免升版本） */
  bikeName?: string;
}

/**
 * 逐点记录实体（activity_records 表）。
 * 仅存规格 §18 列出的字段；grade 字段暂不落库（规格字段清单未含）。
 */
export interface ActivityRecordEntity extends ActivityRecord {
  /** 自增主键（写库时由 Dexie 生成，无需手动指定） */
  id?: number;

  /** 所属活动 ID */
  activityId: string;
}

/** 导入文件状态（规格 §18） */
export type ImportStatus = 'imported' | 'failed' | 'skipped';

/**
 * 导入文件台账实体（files 表）。
 */
export interface FileEntity {
  /** 文件内容指纹（SHA-256，主键） */
  fingerprint: string;

  /** 源文件名 */
  fileName: string;

  /** 文件大小（字节；失败时未知记为 0） */
  fileSize: number;

  /** 导入时间（ISO 8601） */
  importedAt: string;

  /** 导入状态 */
  status: ImportStatus;

  /** 失败原因（status 为 failed 时提供） */
  errorMessage?: string;

  /**
   * 原始 FIT 字节（规格 §19 可选保存，默认不存）。
   * 非索引字段，Dexie 无需升版本即可读写；导出 JSON 时剥离（不可序列化）。
   */
  data?: ArrayBuffer;
}

/**
 * 设置项实体（settings 表）。
 */
export interface SettingsEntry {
  /** 设置键 */
  key: string;

  /** 设置值（任意可结构化克隆数据） */
  value: unknown;
}

/**
 * 赛段实体（segments 表，后续工作项：完整 Segment）。
 *
 * 赛段 = 起点圆 + 终点圆（半径见 segmentMatching.SEGMENT_RADIUS_METERS），
 * 轨迹顺序穿越两圆即记一次成绩（计时取两进入事件间的秒数）。
 */
export interface SegmentEntity {
  /** 自增主键（写库时由 Dexie 生成） */
  id?: number;

  /** 赛段名称（默认取来源活动名） */
  name: string;

  /** 起点纬度（十进制度） */
  startLatitude: number;

  /** 起点经度（十进制度） */
  startLongitude: number;

  /** 终点纬度（十进制度） */
  endLatitude: number;

  /** 终点经度（十进制度） */
  endLongitude: number;

  /** 来源活动 ID（从哪次骑行创建） */
  sourceActivityId: string;

  /** 创建时间（ISO 8601） */
  createdAt: string;

  /** Strava 赛段 ID（从 Strava 导入时记录，用于去重；非索引字段免升 DB_VERSION） */
  stravaId?: number;

  /** 赛段轨迹点（GPX 导入时存储，[纬度, 经度] 数组；非索引字段免升 DB_VERSION） */
  trackPoints?: [number, number][];
}

/**
 * 瓦片缓存实体（tile_cache 表，离线地图）。
 *
 * 缓存地图瓦片二进制（Blob），按最后访问时间做 LRU 淘汰，
 * 离线/弱网时地图底图可用（功能队列：离线地图）。非用户业务数据，导出/清空数据不涉及。
 */
export interface TileCacheEntry {
  /** 瓦片 URL（规范化 key，去掉子域差异） */
  url: string;

  /** 瓦片二进制（Blob，IndexedDB 原生支持结构化存储） */
  blob: Blob;

  /** 瓦片大小（字节，用于字节上限淘汰） */
  size: number;

  /** 最后访问时间（Unix 毫秒，LRU 淘汰依据） */
  lastAccess: number;
}

/**
 * 全量扫描持久化缓存实体（scan_cache 表，v4 新增）。
 *
 * 缓存热力图/路线图等页面的全量逐点扫描产物（抽稀轨迹、路线聚类结果），
 * 避免每次刷新页面后首次进入都重扫全部 records（几十万点级）。
 * fingerprint 为活动集合内容指纹（summariesScanKey），数据变化自动失效。
 */
export interface ScanCacheEntity {
  /** 缓存名（主键）：如 'heatmap-tracks' / 'routes-map' */
  name: string;

  /** 活动集合内容指纹（不匹配即视为失效） */
  fingerprint: string;

  /** 扫描产物（结构化存储，各页面自定义形状） */
  payload: unknown;
}

/**
 * cycling-data 数据库（规格 §18）。
 *
 * 索引设计：
 * - activities.fingerprint 唯一索引（& 前缀），重复导入检测走主键级查重
 * - activities.startTime 索引：按时间排序与范围聚合（summarizeByRange）
 * - activities.activityType 索引：类型筛选
 * - activity_records.activityId 索引：按活动加载逐点数据
 */
export class CyclingDatabase extends Dexie {
  // 表属性用 declare 声明：Dexie 在 version().stores() 注册时动态定义 getter，
  // 若用实例字段声明（useDefineForClassFields 默认开启）会把属性覆盖为 undefined。
  // 属性名必须与表名完全一致（Dexie 无 camelCase 别名机制），
  // 故逐点表属性名为 activity_records（与规格 §18 表名一致）
  /** 活动摘要表（不含 records/route） */
  declare activities: EntityTable<ActivityEntity, 'id'>;

  /** 逐点记录表（自增主键） */
  declare activity_records: EntityTable<ActivityRecordEntity, 'id'>;

  /** 导入文件台账表 */
  declare files: EntityTable<FileEntity, 'fingerprint'>;

  /** 设置表 */
  declare settings: EntityTable<SettingsEntry, 'key'>;

  /** 赛段表（v2 新增） */
  declare segments: EntityTable<SegmentEntity, 'id'>;

  /** 瓦片缓存表（v3 新增） */
  declare tile_cache: EntityTable<TileCacheEntry, 'url'>;

  /** 全量扫描持久化缓存表（v4 新增：热力图/路线图抽稀结果） */
  declare scan_cache: EntityTable<ScanCacheEntity, 'name'>;

  /**
   * 构造数据库实例。
   *
   * @param name 数据库名（默认 cycling-data，测试可传独立库名隔离）
   */
  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      activities: 'id, &fingerprint, startTime, activityType',
      activity_records: '++id, activityId',
      files: 'fingerprint',
      settings: 'key',
    });
    // v2：新增赛段表（既有表结构不变，无需重复声明）
    this.version(2).stores({
      segments: '++id',
    });
    // v3：新增瓦片缓存表（url 主键 + lastAccess 索引用于 LRU 淘汰）
    this.version(3).stores({
      tile_cache: 'url, lastAccess',
    });
    // v4：新增全量扫描持久化缓存表（热力图/路线图抽稀结果，name 主键）
    // 内容指纹存 payload 内层，非索引字段免索引声明
    this.version(4).stores({
      scan_cache: 'name',
    });
  }
}

/** 全局单例数据库实例（应用唯一入口） */
export const db = new CyclingDatabase();
