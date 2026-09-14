/**
 * IndexedDB 数据库定义（规格 §18）。
 *
 * 库名 cycling-data，当前 DB_VERSION = 6，表结构：
 * - activities：活动摘要（不存 records/route，大数据拆表避免单条记录过大）
 * - activity_blobs：逐点数据，每活动一行（v5 起，替代逐点行表）
 * - activity_records：旧逐点行表（迁移兜底，迁移完成后不再写入）
 * - files：导入文件状态台账（重复检测、失败记录）
 * - settings：键值对设置
 * - segments / segment_efforts：赛段定义与成绩落库（v2 / v6）
 * - tile_cache / scan_cache：离线瓦片与导入扫描结果缓存
 *
 * 单位约定与领域模型一致（src/types/activity.ts，规格 §11）：
 * 距离米、速度 m/s、海拔米、心率 bpm、踏频 rpm、功率 W。
 */
import Dexie, { type EntityTable } from 'dexie';
import type { ActivityRecord, DeviceInfo, TrackOffset } from '@/types/activity';
import type { CoordinateSystem } from '@/geo/coordinateSystem';

/** 数据库名称 */
export const DB_NAME = 'cycling-data';

/**
 * 数据库版本号（v2：新增 segments 赛段表；v3：新增 tile_cache 瓦片缓存表；
 * v4：新增 scan_cache 扫描缓存表；v5：新增 activity_blobs 逐点整活动存储表，
 * 旧 activity_records 逐点行表保留至数据后台迁移完成后由应用层清空，v7 物理删除；
 * v6：新增 segment_efforts 赛段成绩落库表，替代「每次进赛段页全量重扫」）。
 */
export const DB_VERSION = 6;

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

  /**
   * 用户确认运动类型的时间（Unix 秒）；非索引字段，免升版本。
   *
   * 只有「用户在批量修正弹窗里亲手应用过类型」的活动才会带上此标记，
   * 用于让类型复核检测不再重复提示同一条记录（灰区记录库里类型仍是
   * cycling，若不标记，每次进列表都会被重新检出，提示永远消不掉）。
   * 导入映射不写该字段——新导入的活动一律视为未确认。
   */
  typeConfirmedAt?: number;

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

  /** 累计爬升（米；无海拔数据源（如行者 GPX）为 undefined；非索引字段，放宽类型免升版本） */
  elevationGain?: number;

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

  /**
   * 轨迹坐标系（纠偏用；非索引字段，免升版本）。
   * 落库 records 恒为原始坐标，本字段标记其所属坐标系；纠偏只改标记不改写数据。
   * 缺省视为 WGS-84。
   */
  coordinateSystem?: CoordinateSystem;

  /** 数据来源 App 标识（如 'xingzhe'；非索引字段，免升版本） */
  sourceApp?: string;

  /** 轨迹手动微调量（米；非索引字段，免升版本） */
  trackOffset?: TrackOffset;

  /** 轨迹首个有效坐标（非索引字段；SimilarRides 分组无需加载完整轨迹） */
  routeStartLatitude?: number;
  routeStartLongitude?: number;

  /** 轨迹最后一个有效坐标（非索引字段；SimilarRides 分组无需加载完整轨迹） */
  routeEndLatitude?: number;
  routeEndLongitude?: number;
}

/**
 * 逐点整活动存储实体（activity_blobs 表，v5 新增）。
 *
 * 设计动机：旧 activity_records 逐点一行，删除一条活动需逐行删除
 * （IndexedDB 无批量/范围删除 API，实测约 0.22ms/行，单活动数千~数万点
 * 时删除/导入均秒级~分钟级卡顿）。改为每活动一行后删除=删 1 行主键、
 * 导入=写 1 行大 value（结构化克隆原生支持），均毫秒级。
 *
 * 与规格 §18 的偏差：表名与行粒度变更，字段清单不变（grade 仍不落库）。
 */
export interface ActivityBlobEntity {
  /** 所属活动 ID（主键） */
  activityId: string;

  /** 该活动全部逐点记录（数组序 = 原存储序 = 时间序） */
  records: ActivityRecord[];
}

/**
 * 旧逐点记录实体（activity_records 表，v4 及之前；v5 起仅迁移兜底读写，
 * 后台迁移完成后清空，v6 计划物理删除）。
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

  /**
   * 赛段成绩最近一次全量扫描落库时间（ISO 8601；非索引字段免升 DB_VERSION）。
   * 赛段详情页据此判断「无成绩」是「确实没人穿越」还是「从未扫描过」：
   * 已扫描过则不再重复全量扫描（新活动导入后由赛段页扫描自动刷新全量成绩）。
   */
  effortsSyncedAt?: string;
}

/**
 * 赛段成绩实体（segment_efforts 表，v6 新增）。
 *
 * 一次赛段穿越 = 某活动在赛段上的最佳用时（与 Strava 单活动最佳成绩口径一致）。
 * 设计动机：旧实现每次进赛段页全量重扫所有活动逐点数据（仅靠 Web Worker 缓解），
 * 详情页「本次赛段 vs 个人最好」也无 PR 可查。落库后：
 * - 赛段页 / 详情页读库即得成绩榜与 PR；
 * - 全量扫描只在活动集合指纹变化时发生一次，结果写回本表；
 * - 详情页实时匹配本活动后增量回写（upsert，[segmentId+activityId] 唯一）。
 *
 * 指标字段（均速/均功率/均心率）为穿越窗口内的真实平均值，
 * 缺失（无对应传感器数据）= undefined ≠ 0，UI 显示 —（与全站口径一致）。
 */
export interface SegmentEffortEntity {
  /** 自增主键（写库时由 Dexie 生成） */
  id?: number;

  /** 所属赛段 ID（segments.id） */
  segmentId: number;

  /** 活动 ID（本地库 activityId 或作者快照活动 ID） */
  activityId: string;

  /** 活动开始时间（ISO 8601，榜单/趋势图展示用） */
  startTime: string;

  /** 穿越用时（秒） */
  durationSeconds: number;

  /** 穿越窗口平均速度（m/s，GPS 路径距离 / 用时；无 GPS 数据为 undefined） */
  avgSpeed?: number;

  /** 穿越窗口平均功率（W；无功率计为 undefined） */
  avgPower?: number;

  /** 穿越窗口平均心率（bpm；无心率带为 undefined） */
  avgHeartRate?: number;

  /** 落库时间（ISO 8601） */
  createdAt: string;
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
 * - activity_blobs.activityId 主键：按活动加载/删除逐点数据（整活动一行）
 * - segment_efforts.&[segmentId+activityId] 唯一复合索引：同活动同赛段一条最佳成绩，
 *   upsert 与按赛段/按活动级联清理走 segmentId / activityId 单索引
 */
export class CyclingDatabase extends Dexie {
  // 表属性用 declare 声明：Dexie 在 version().stores() 注册时动态定义 getter，
  // 若用实例字段声明（useDefineForClassFields 默认开启）会把属性覆盖为 undefined。
  // 属性名必须与表名完全一致（Dexie 无 camelCase 别名机制），
  // 故逐点表属性名为 activity_records（与规格 §18 表名一致）
  /** 活动摘要表（不含 records/route） */
  declare activities: EntityTable<ActivityEntity, 'id'>;

  /** 逐点记录表（自增主键；v4 及之前的主存储，v5 起仅迁移兜底） */
  declare activity_records: EntityTable<ActivityRecordEntity, 'id'>;

  /** 逐点整活动存储表（v5 新增：每活动一行，records 数组为主值） */
  declare activity_blobs: EntityTable<ActivityBlobEntity, 'activityId'>;

  /** 导入文件台账表 */
  declare files: EntityTable<FileEntity, 'fingerprint'>;

  /** 设置表 */
  declare settings: EntityTable<SettingsEntry, 'key'>;

  /** 赛段表（v2 新增） */
  declare segments: EntityTable<SegmentEntity, 'id'>;

  /** 赛段成绩表（v6 新增：穿越落库，替代全量重扫） */
  declare segment_efforts: EntityTable<SegmentEffortEntity, 'id'>;

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
    // v5：新增逐点整活动存储表（activityId 主键，每活动一行）。
    // 旧数据不在此处迁移（阻塞升级事务 10~30s 体验差），由应用启动后的
    // 后台分批迁移完成（见 src/storage/recordsMigration.ts）；
    // 旧 activity_records 表保留，迁移完成后由应用层清空，v7 物理删除。
    this.version(5).stores({
      activity_blobs: 'activityId',
    });
    // v6：新增赛段成绩落库表（每次进赛段页全量重扫的替代方案）。
    // [segmentId+activityId] 唯一复合索引：同一活动在同一赛段只有一条最佳成绩，
    // 详情页实时匹配回写按此 upsert；segmentId / activityId 单索引供榜单与级联清理。
    this.version(6).stores({
      segment_efforts: '++id, segmentId, activityId, &[segmentId+activityId]',
    });

    // 多标签页防死锁：旧标签持数据库连接时升级会被 IndexedDB 阻塞，
    // 新标签的 db.open() 会一直挂起。Dexie 触发 'blocked' 事件代表有
    // 其他标签正在使用旧版本。此处仅提示用户手动关闭其他标签——
    // 浏览器会对所有持旧连接的标签自动触发其 'versionchange' 监听
    // （见下），无需也无法从本标签跨标签页通知（window 事件不跨标签）
    this.on('blocked', () => {
      // 用 window.confirm 而非自定义弹窗：本场景是部署时出现一次
      // （发布后老用户重新打开页面），引导文案说清操作步骤即可
      void window.confirm(
        '检测到其他浏览器标签页正在使用旧版本数据。\n请关闭其他同站标签页，然后重新加载本页以完成数据升级。',
      )
    })

    // 本标签持旧连接：close() 主动放行升级（IndexedDB 规范要求旧连接
    // close 后新版本才能继续），再提示并重载——否则 alert 悬停期间
    // 新标签会一直卡在 blocked
    this.on('versionchange', () => {
      this.close()
      window.alert('数据已升级，请重新加载当前页面以使用新版本。')
      window.location.reload()
    })
  }
}

/** 全局单例数据库实例（应用唯一入口） */
export const db = new CyclingDatabase();
