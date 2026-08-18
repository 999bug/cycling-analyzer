/**
 * 作者数据快照客户端：按文件懒加载 + 会话内缓存。
 *
 * 快照为构建产物（public/author-data/，scripts/buildAuthorData.ts 生成），
 * 一次会话内不可变，缓存无需失效；跨部署更新由重新加载页面自然生效。
 * 路径拼 import.meta.env.BASE_URL 适配 GitHub Pages 子路径部署。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import type { ActivityRecord } from '@/types/activity'
import type { UserProfile } from '@/features/settings/settings'
import type { SegmentEntity } from '@/storage/db'
import type { RouteGroup } from '@/features/routes/routeGrouping'
import type { PowerRecordEntry } from '@/features/records/personalRecords'
import type {
  ActivityRecordsFile,
  AuthorSnapshotManifest,
  SegmentResultsFile,
  TracksFile,
} from '@/storage/authorData/snapshotTypes'

/** 作者快照客户端（工厂创建，测试可注入假实现） */
export interface SnapshotClient {
  /** 快照元信息（启动探测用） */
  getManifest(): Promise<AuthorSnapshotManifest>

  /** 全部活动摘要（startTime 降序） */
  getActivities(): Promise<ActivitySummary[]>

  /** 单条活动逐点记录（详情页按需） */
  getRecords(activityId: string): Promise<ActivityRecord[]>

  /** 作者训练配置（ftp/maxHeartRate 等） */
  getProfile(): Promise<UserProfile>

  /** 作者赛段定义 */
  getSegments(): Promise<SegmentEntity[]>

  /** 预计算：全部轨迹抽稀点（热力图页） */
  getTracks(): Promise<TracksFile>

  /** 预计算：赛段成绩榜（赛段页） */
  getSegmentResults(): Promise<SegmentResultsFile>

  /** 预计算：路线分组（统计页） */
  getRouteGroups(): Promise<RouteGroup[]>

  /** 预计算：功率纪录（统计页） */
  getPowerRecords(): Promise<PowerRecordEntry[]>
}

/**
 * 创建快照客户端。
 * 每个实例独立缓存（测试隔离用）；应用内使用 defaultSnapshotClient 单例。
 */
export function createSnapshotClient(): SnapshotClient {
  const cache = new Map<string, Promise<unknown>>()

  /**
   * 拉取并缓存一个快照 JSON 文件。
   *
   * @param path 相对快照根的路径（如 records/xxx.json）
   * @throws Error HTTP 非 200（消息含路径与状态码）
   */
  function fetchJson<T>(path: string): Promise<T> {
    let pending = cache.get(path)
    if (pending === undefined) {
      pending = fetch(`${import.meta.env.BASE_URL}author-data/${path}`).then((res) => {
        if (!res.ok) {
          throw new Error(`Author snapshot fetch failed: ${path} (HTTP ${res.status})`)
        }
        return res.json() as Promise<unknown>
      })
      cache.set(path, pending)
    }
    return pending as Promise<T>
  }

  return {
    getManifest: () => fetchJson('manifest.json'),
    getActivities: () => fetchJson('activities.json'),
    getRecords: (activityId) =>
      fetchJson<ActivityRecordsFile>(`records/${activityId}.json`).then((file) => file.records),
    getProfile: () => fetchJson('profile.json'),
    getSegments: () => fetchJson('segments.json'),
    getTracks: () => fetchJson('precomputed/tracks.json'),
    getSegmentResults: () => fetchJson('precomputed/segment-results.json'),
    getRouteGroups: () => fetchJson('precomputed/route-groups.json'),
    getPowerRecords: () => fetchJson('precomputed/power-records.json'),
  }
}

/** 默认快照客户端单例（应用唯一入口） */
export const defaultSnapshotClient = createSnapshotClient()
