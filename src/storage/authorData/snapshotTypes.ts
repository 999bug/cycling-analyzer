/**
 * 作者数据快照类型（构建脚本与前端快照客户端共用的跨层契约）。
 *
 * 快照由 scripts/author-data/buildAuthorData.ts 在 CI 生成，
 * 前端经 snapshotClient 按文件懒加载。全部字段 JSON 可序列化，
 * 单位与领域模型一致（米/m/s/bpm/W/Unix 秒，见 src/types/activity.ts）。
 */
import type { ActivityRecord } from '@/types/activity'
import type { SegmentEffort } from '@/features/segments/segmentMatching'

/** 快照格式版本（前端校验，不兼容即回退本地数据源） */
export const SNAPSHOT_VERSION = 1

/** manifest.json：快照元信息 */
export interface AuthorSnapshotManifest {
  /** 快照格式版本 */
  snapshotVersion: number

  /** 作者显示名（切换器/横幅文案） */
  author: string

  /** 构建时间（ISO 8601） */
  generatedAt: string

  /** 活动条数 */
  activityCount: number
}

/** records/<id>.json：单条活动逐点记录 */
export interface ActivityRecordsFile {
  /** 所属活动 ID（= 文件内容指纹） */
  activityId: string

  /** 逐点记录（字段与 Dexie 落库清单一致，不含 grade） */
  records: ActivityRecord[]
}

/** precomputed/tracks.json：全部轨迹抽稀点（热力图/网格覆盖用） */
export interface TracksFile {
  /** 抽稀阈值（米），与热力图页本地口径一致 */
  toleranceMeters: number

  /** 每条轨迹为 [纬度, 经度] 元组数组（5 位小数）；无坐标活动不出现 */
  tracks: [number, number][][]
}

/** precomputed/segment-results.json：赛段 ID（字符串化）→ 成绩榜 */
export type SegmentResultsFile = Record<string, SegmentEffort[]>
