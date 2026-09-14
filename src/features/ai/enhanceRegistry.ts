/**
 * AI 增强注册表（v4）：模块级有序登记已挂载的增强区块，
 * 供「一键解读全部」按挂载顺序串行触发（串行而非并发，控制并发成本）。
 */

/** 增强注册表条目 */
export interface EnhanceEntry {
  /** 是否已生成过 AI 内容 */
  hasAi: () => boolean

  /** 触发生成（返回 Promise 供一键按钮串行等待） */
  run: () => Promise<void>
}

/** 模块级有序注册表（cacheKey → 条目；挂载顺序即一键解读顺序） */
const enhanceRegistry = new Map<string, EnhanceEntry>()

/** 注册表版本号 + 订阅者（一键按钮据此响应区块挂载/卸载） */
let registryVersion = 0
const registryListeners = new Set<() => void>()
function bumpRegistry() {
  registryVersion += 1
  registryListeners.forEach((listener) => listener())
}

/** 订阅注册表变化（useSyncExternalStore 用） */
export function subscribeEnhanceRegistry(listener: () => void): () => void {
  registryListeners.add(listener)
  return () => registryListeners.delete(listener)
}

/** 注册表当前版本号 */
export function getEnhanceRegistryVersion(): number {
  return registryVersion
}

/**
 * 登记 / 更新一个增强区块。
 *
 * @param key cacheKey
 * @param entry 条目
 */
export function registerEnhance(key: string, entry: EnhanceEntry): void {
  enhanceRegistry.set(key, entry)
  bumpRegistry()
}

/**
 * 移除一个增强区块（区块卸载时）。
 *
 * @param key cacheKey
 */
export function unregisterEnhance(key: string): void {
  if (enhanceRegistry.delete(key)) {
    bumpRegistry()
  }
}

/**
 * 串行执行全部已挂载且未生成的增强区块。
 */
export async function runAllEnhancements(): Promise<void> {
  for (const entry of enhanceRegistry.values()) {
    if (!entry.hasAi()) {
      await entry.run()
    }
  }
}

/** 是否存在已挂载的增强区块（一键按钮显隐用） */
export function hasEnhanceEntries(): boolean {
  return enhanceRegistry.size > 0
}
