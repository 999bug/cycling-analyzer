/**
 * 地图伪全屏（PWA 独立窗口降级方案）。
 *
 * Android Chromium 在 standalone 独立窗口里运行时调用 requestFullscreen()
 * 存在整页卡死的已知 bug 族（系统栏与全屏状态互相冲突，crbug 1232956 /
 * 1415037 等），而手机浏览器标签页内完全正常。因此独立窗口环境不碰
 * Fullscreen API，改用 fixed 顶置覆盖层模拟全屏；原生 API 缺失（iPhone
 * Safari 不支持元素全屏）或调用被拒时同样降级。
 *
 * 样式见 mapFullscreen.css（.map-fullscreen-pseudo）；调用方为 mapFullscreen.tsx
 * 的 MapFullscreenButton（独立成模块：react-refresh 要求组件文件只导出组件）。
 */

/** 伪全屏类名（挂在全屏包裹层上） */
export const MAP_PSEUDO_FULLSCREEN_CLASS = 'map-fullscreen-pseudo'

/** 包裹层是否处于伪全屏 */
export function isPseudoFullscreen(wrapper: HTMLElement | null): boolean {
  return wrapper?.classList.contains(MAP_PSEUDO_FULLSCREEN_CLASS) ?? false
}

/** 进入伪全屏：包裹层 fixed 顶置铺满视口（样式接管，不碰 Fullscreen API） */
export function enterPseudoFullscreen(wrapper: HTMLElement): void {
  wrapper.classList.add(MAP_PSEUDO_FULLSCREEN_CLASS)
}

/** 退出伪全屏 */
export function exitPseudoFullscreen(wrapper: HTMLElement): void {
  wrapper.classList.remove(MAP_PSEUDO_FULLSCREEN_CLASS)
}
