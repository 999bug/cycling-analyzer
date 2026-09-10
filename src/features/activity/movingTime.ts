/**
 * 轨迹「运动中」判定：区分骑行推进与暂停（红灯/休息/记录断档）的单一口径。
 *
 * 判定只依赖「相邻点的时间间隔 + 累计距离差」，不依赖速度字段——
 * GPX 等数据源没有 session 计时信息，且设备速度字段在静止时可能缺失。
 *
 * 三档判定：
 * - 正常间隔（≤ MOVING_GAP_LIMIT_SEC）：位移速度高于 MOVING_SPEED_THRESHOLD_MPS
 *   才视为运动中，防止静止时的 GPS 抖动虚增移动时间；
 * - 短缺口（MOVING_GAP_LIMIT_SEC ～ PAUSE_GAP_LIMIT_SEC）：行者等 App 静止时会
 *   降频记录（几十秒一个点）或短暂停歇，按两端位移区分——挪动 ≥ PAUSE_DRIFT_METERS
 *   视为计时未停（运动中），几乎没动视为已暂停；
 * - 长缺口（> PAUSE_GAP_LIMIT_SEC）：视为暂停/记录断档，整段不算运动。
 *
 * 两个消费方共用本模块，保证口径天然一致：
 * - 活动汇总的「计时时长」（@/fit/calculator）——决定均速分母；
 * - 在线回放 / 回放视频导出的时间轴（@/map/replayCore）——暂停段在时间轴上宽度为 0。
 */

/**
 * 运动判定速度阈值（m/s，≈1.8km/h，Strava 同级）：
 * 相邻点位移速度高于该值的时间段计入运动时间，低于视为静止
 * （GPS 抖动单点位移通常 < 0.5m/s，不会累积进移动时间）。
 */
export const MOVING_SPEED_THRESHOLD_MPS = 0.5

/**
 * 正常采样间隔上限（秒）：不超过该值的相邻点按位移速度判定运动/静止。
 */
export const MOVING_GAP_LIMIT_SEC = 30

/**
 * 暂停判定缺口（秒）：MOVING_GAP_LIMIT_SEC ～ 该值之间的记录缺口视为
 * 「短停」；超过该值的缺口视为暂停/记录断档，整段剔除。
 */
export const PAUSE_GAP_LIMIT_SEC = 60

/**
 * 短缺口停止判定位移（米）：30~60s 短缺口两端的位移低于该值视为「完全停止」
 * （GPS 漂移级位移，码表自动暂停已触发）。
 */
export const PAUSE_DRIFT_METERS = 8

/**
 * 判定相邻两点之间是否处于运动中（依赖累计距离字段）。
 *
 * @param prev 前一个点
 * @param curr 后一个点（timestamp 不早于 prev）
 * @returns 该时间段的位移是否应计入运动时间
 */
export function isMovingSegment(
  prev: { timestamp: number; distance?: number },
  curr: { timestamp: number; distance?: number },
): boolean {
  const dt = curr.timestamp - prev.timestamp
  if (dt <= 0 || dt > PAUSE_GAP_LIMIT_SEC) {
    return false
  }
  const displacement = (curr.distance ?? 0) - (prev.distance ?? 0)
  if (dt > MOVING_GAP_LIMIT_SEC) {
    // 短缺口：两端有真实挪动则计时未停，位移仅漂移级则已暂停
    return displacement >= PAUSE_DRIFT_METERS
  }
  return displacement / dt > MOVING_SPEED_THRESHOLD_MPS
}

/**
 * 累计运动时长（秒）：逐段判定后累加。
 *
 * @param points 按 timestamp 升序的轨迹点（依赖累计距离字段）
 * @returns 运动时长（秒）；无法判定（无位移数据）时为 0
 */
export function movingDurationOf(
  points: readonly { timestamp: number; distance?: number }[],
): number {
  let moving = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    if (isMovingSegment(prev, curr)) {
      moving += curr.timestamp - prev.timestamp
    }
  }
  return moving
}
