/**
 * 骑行领域模型。
 *
 * 由 FIT 文件解析标准化而来，UI 层只依赖此模型，
 * 不直接接触 @garmin/fitsdk 的数据结构。
 *
 * 单位约定（规格 §11）：
 * - 距离：米
 * - 速度：m/s
 * - 海拔：米
 * - 心率：bpm
 * - 踏频：rpm
 * - 功率：W
 * - 时间：Unix 秒（records）/ ISO 8601 字符串（Activity）
 * - 经纬度：十进制度
 */

/**
 * 骑行活动（一次骑行的完整记录）。
 */
export interface Activity {
  /** 活动唯一标识（导入时生成） */
  id: string

  /** 源 FIT 文件标识 */
  fileId: string

  /** 源文件名 */
  fileName: string

  /** 文件内容指纹（SHA-256），用于重复检测 */
  fingerprint: string

  /** 运动类型（如 cycling / running） */
  activityType: string

  /** 开始时间（ISO 8601） */
  startTime: string

  /** 结束时间（ISO 8601） */
  endTime: string

  /** 骑行计时时长（秒） */
  duration: number

  /** 总耗时（秒，含暂停） */
  elapsedTime: number

  /** 总距离（米） */
  distance: number

  /** 累计爬升（米） */
  elevationGain: number

  /** 累计下降（米） */
  elevationLoss?: number

  /** 消耗卡路里（千卡） */
  calories?: number

  /** 平均速度（m/s） */
  avgSpeed?: number

  /** 最高速度（m/s） */
  maxSpeed?: number

  /** 平均心率（bpm） */
  avgHeartRate?: number

  /** 最高心率（bpm） */
  maxHeartRate?: number

  /** 平均踏频（rpm） */
  avgCadence?: number

  /** 最高踏频（rpm） */
  maxCadence?: number

  /** 平均功率（W） */
  avgPower?: number

  /** 最高功率（W） */
  maxPower?: number

  /** 标准化功率（W，后续版本计算） */
  normalizedPower?: number

  /** 训练负荷（TSS，后续版本计算） */
  trainingLoad?: number

  /** 功能阈值功率（W，后续版本计算） */
  ftp?: number

  /** 设备信息 */
  device?: DeviceInfo

  /** 抽稀后的轨迹（地图绘制用，后续版本生成） */
  route?: RoutePoint[]

  /** 完整逐点数据（不参与列表查询，详情页按需加载） */
  records?: ActivityRecord[]
}

/**
 * 设备信息。
 */
export interface DeviceInfo {
  /** 厂商名称 */
  manufacturer?: string

  /** 产品 ID */
  product?: string

  /** 产品名称 */
  productName?: string

  /** 序列号 */
  serialNumber?: number

  /** 软件版本 */
  softwareVersion?: number
}

/**
 * 逐点骑行数据（规格 §11）。
 * 可选字段缺失时为 undefined（区别于 0）。
 */
export interface ActivityRecord {
  /** 时间（Unix 秒） */
  timestamp: number

  /** 纬度（十进制度） */
  latitude?: number

  /** 经度（十进制度） */
  longitude?: number

  /** 海拔（米） */
  altitude?: number

  /** 累计距离（米） */
  distance?: number

  /** 速度（m/s） */
  speed?: number

  /** 心率（bpm） */
  heartRate?: number

  /** 踏频（rpm） */
  cadence?: number

  /** 功率（W） */
  power?: number

  /** 温度（摄氏度） */
  temperature?: number

  /** 坡度（百分比，可计算时提供） */
  grade?: number
}

/**
 * 轨迹点（地图绘制用，规格 §12）。
 * 与 ActivityRecord 相比不含 grade/temperature，
 * 且经纬度为必填（无坐标的点不进入轨迹）。
 */
export interface RoutePoint {
  /** 时间（Unix 秒） */
  timestamp: number

  /** 纬度（十进制度） */
  latitude: number

  /** 经度（十进制度） */
  longitude: number

  /** 海拔（米） */
  altitude?: number

  /** 累计距离（米） */
  distance?: number

  /** 速度（m/s） */
  speed?: number

  /** 心率（bpm） */
  heartRate?: number

  /** 踏频（rpm） */
  cadence?: number

  /** 功率（W） */
  power?: number
}
