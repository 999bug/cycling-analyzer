/**
 * 地图高度拖拽调整的纯逻辑：钳制、持久化读写（localStorage 容错）。
 * 与组件解耦（可单测、避免 fast-refresh 导出限制）。
 */

/** 地图最小高度（px）：低于此值地图失去信息量 */
export const MAP_HEIGHT_MIN = 260

/** 高度持久化 key */
export const MAP_HEIGHT_STORAGE_KEY = 'cycling-analyzer:map-height'

/** 视口高度扣除量：拖到最大时底部仍保留可视内容区 */
const MAP_HEIGHT_VIEWPORT_RESERVE = 160

/**
 * 钳制地图高度到 [MAP_HEIGHT_MIN, 视口高度 - 预留] 区间。
 * 视口过小时退化为 MAP_HEIGHT_MIN（保证地图可用）。
 *
 * @param height 期望高度（px）
 * @param viewportHeight 当前视口高度（window.innerHeight）
 */
export function clampMapHeight(height: number, viewportHeight: number): number {
  if (Number.isNaN(height)) {
    return MAP_HEIGHT_MIN
  }
  const max = Math.max(MAP_HEIGHT_MIN, viewportHeight - MAP_HEIGHT_VIEWPORT_RESERVE)
  return Math.min(Math.max(height, MAP_HEIGHT_MIN), max)
}

/**
 * 读取持久化的地图高度；无有效记录或存储不可用时返回 null（走 CSS 默认高度）。
 */
export function loadSavedMapHeight(): number | null {
  try {
    const raw = localStorage.getItem(MAP_HEIGHT_STORAGE_KEY)
    if (raw === null) {
      return null
    }
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= MAP_HEIGHT_MIN ? parsed : null
  } catch {
    return null
  }
}

/**
 * 持久化地图高度（取整存储）；存储不可用时静默忽略（隐私模式等场景）。
 *
 * @param height 高度（px）
 */
export function saveMapHeight(height: number): void {
  try {
    localStorage.setItem(MAP_HEIGHT_STORAGE_KEY, String(Math.round(height)))
  } catch {
    // 存储不可用（隐私模式/配额满）时不影响主流程
  }
}
