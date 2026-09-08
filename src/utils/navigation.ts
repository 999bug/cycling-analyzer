/**
 * 整页刷新（location.reload 的可注入包装）。
 *
 * 独立成模块的原因：jsdom 的 location.reload 是不可 stub 的只读属性，
 * 单测无法直接断言刷新行为——经本模块间接调用后测试用 vi.mock 注入
 * （ImportPanel 导入关闭刷新 / SettingsPage 清空后刷新 / ErrorBoundary 重载共用）。
 */
export function reloadPage(): void {
  window.location.reload()
}
