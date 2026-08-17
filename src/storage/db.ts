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

/** 数据库版本号 */
export const DB_VERSION = 1;

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

  /** 设备信息 */
  device?: DeviceInfo;
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

  /**
   * 构造数据库实例。
   *
   * @param name 数据库名（默认 cycling-data，测试可传独立库名隔离）
   */
  constructor(name: string = DB_NAME) {
    super(name);
    this.version(DB_VERSION).stores({
      activities: 'id, &fingerprint, startTime, activityType',
      activity_records: '++id, activityId',
      files: 'fingerprint',
      settings: 'key',
    });
  }
}

/** 全局单例数据库实例（应用唯一入口） */
export const db = new CyclingDatabase();
