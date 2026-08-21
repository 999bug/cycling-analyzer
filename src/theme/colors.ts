/**
 * 图表与区间语义调色板（与 index.css CSS 变量同源）。
 *
 * Recharts 等 JS 侧无法直接引用 CSS 变量（Canvas/SVG 属性部分场景不生效），
 * 用常量保持与 :root 变量一致；主题切换时 CSS 变量生效，图表色仅在深色主题下展示。
 *
 * 规范：品牌荧光绿仅用于品牌强调（logo/主按钮），图表使用语义色（info/success/warning/danger）。
 */

/** 训练区间色板（Z1 恢复 → Z5 冲刺，色阶由冷到暖） */
export const ZONE_COLORS: readonly string[] = [
  '#4f8cff', // Z1 恢复区 — info
  '#34c759', // Z2 耐力区 — success
  '#ffd60a', // Z3 有氧区 — warning 亮黄
  '#ff9f0a', // Z4 阈值区 — warning
  '#ff453a', // Z5 冲刺区 — danger
]

/** 训练状态线色（CTL/ATL/TSB） */
export const TRAINING_LINE_COLORS = {
  ctl: '#4f8cff', // 积极/累积 — info
  atl: '#ff453a', // 疲劳 — danger
  tsb: '#34c759', // 状态 — success
} as const

/** 表现趋势系列色 */
export const PERFORMANCE_SERIES_COLORS = {
  distance: '#4f8cff',
  distanceMa4: '#8aa4c9',
  tss: '#ff9f0a',
  ef: '#34c759',
  efMa4: '#7db88b',
} as const

/** 平路/爬坡色带（半透明；与 ZONE_COLORS 同源） */
export const SEGMENT_BAND_COLORS = {
  flat: 'rgba(79, 140, 255, 0.18)', // info 半透明
  climb: 'rgba(249, 115, 22, 0.28)', // warning 半透明
} as const

/** 对比图系列色 */
export const COMPARE_COLORS = {
  current: '#4f8cff', // 当前活动 — info
  baseline: '#ff9f0a', // 基准活动 — warning
} as const
