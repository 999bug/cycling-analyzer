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
