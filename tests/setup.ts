import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

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
