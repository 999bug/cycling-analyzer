import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import 'fake-indexeddb/auto';

// jsdom 无真实网络/IndexedDB Blob：统一把瓦片缓存层 mock 成无害 div。
// 离线地图的瓦片 fetch 会真实发包（CI 无外网→超时），且 fake-indexeddb 读回的
// Blob 不是真 Blob（URL.createObjectURL 抛 TypeError），污染 indexeddb 测试。
// 各测试文件可再自带 vitest.mock 覆盖本默认（fallbackTileLayer.test.tsx 即如此）。
vi.mock('@/map/CachingTileLayer', () => ({
  CachingTileLayerComponent: () => null,
}));

/**
 * jsdom 缺少 ResizeObserver（Recharts 的 ResponsiveContainer 依赖它做布局测量），
 * 提供空实现 stub 避免组件挂载时报错。图表尺寸由 initialDimension 兜底。
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// 全局注入：jsdom 环境下 Recharts 使用 initialDimension 即可渲染，无需真实测量
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

/**
 * jsdom 缺少 matchMedia（主题跟随系统与媒体查询依赖）：
 * 提供基础 stub（matches: false = 深色默认），具体行为由各测试 stub 覆盖。
 */
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
