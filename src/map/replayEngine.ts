/**
 * 在线回放引擎：框架无关的播放状态机（与 React / Leaflet 完全解耦）。
 *
 * 设计动机（重写版）：旧实现中父组件与地图覆盖层各自跑一个 rAF 循环，
 * 通过共享 ref 传递进度——两条循环时序竞争、逻辑分散、难以单测。
 * 本引擎收敛为**唯一的 rAF 循环**，按订阅通道分级广播：
 *
 * - `onFrame`：每帧（≤60Hz）广播精确帧 { 进度, 点索引, 插值坐标 }，
 *   供地图覆盖层做命令式渲染（光标 setLatLng / 已走折线增量追加 / 镜头跟随），
 *   不经过任何 React 渲染路径；
 * - `onSync`：节流（默认 10Hz）广播状态快照 { 进度, 播放中, 倍速 }，
 *   供 React 控制条经 useSyncExternalStore 订阅，滑块/HUD 不再每帧 reconcile。
 *
 * 边界处理：单帧推进上限（标签页切回不跳进度）、播完自动暂停、
 * 末尾重播自动归零、seek 立即出帧（暂停态拖动也能实时对齐覆盖层）。
 */
import { findIndexAtTimestamp, interpolatePositionAt, type ReplayPoint } from './replayCore'

/** 帧级广播数据（覆盖层命令式渲染的全部输入） */
export interface ReplayFrame {
  /** 权威进度（0~1） */
  progress: number

  /** 目标时刻所在轨迹段的左端点索引（配合 interpolatePositionAt 使用） */
  index: number

  /** 插值后的连续纬度（帧间平滑，无逐点跳动） */
  latitude: number

  /** 插值后的连续经度 */
  longitude: number
}

/** 节流同步快照（React 控制条的订阅载荷） */
export interface ReplaySnapshot {
  /** 展示进度（0~1） */
  progress: number

  /** 是否播放中 */
  playing: boolean

  /** 当前倍速 */
  speed: number
}

/** 引擎构造选项 */
export interface ReplayEngineOptions {
  /** 倍速（默认 1 = 真实时间流速） */
  speed?: number

  /** 快照节流间隔 ms（默认 100） */
  syncIntervalMs?: number

  /** 单帧推进的骑行时间上限秒数（默认 1，防切后台回来跳进度） */
  maxFrameDtSeconds?: number
}

/** 帧订阅回调 */
export type FrameListener = (frame: ReplayFrame) => void

/** 快照订阅回调 */
export type SnapshotListener = (snapshot: ReplaySnapshot) => void

export class ReplayEngine {
  private readonly points: ReplayPoint[]
  private readonly firstTs: number
  private readonly totalSpan: number
  private readonly syncIntervalMs: number
  private readonly maxFrameDtSeconds: number

  private progressState = 0
  private speedState: number
  private playingState = false

  private rafId = 0
  private lastTick: number | null = null
  private lastSync = 0

  private readonly frameListeners = new Set<FrameListener>()
  private readonly snapshotListeners = new Set<SnapshotListener>()

  /** 不可变快照缓存：仅在该对象引用变化时通知订阅者（useSyncExternalStore 契约） */
  private snapshotCache: ReplaySnapshot

  constructor(points: ReplayPoint[], options: ReplayEngineOptions = {}) {
    this.points = points
    this.speedState = options.speed ?? 1
    this.syncIntervalMs = options.syncIntervalMs ?? 100
    this.maxFrameDtSeconds = options.maxFrameDtSeconds ?? 1
    this.firstTs = points[0]?.timestamp ?? 0
    const lastTs = points[points.length - 1]?.timestamp ?? 0
    this.totalSpan = Math.max(lastTs - this.firstTs, 1)
    this.snapshotCache = { progress: 0, playing: false, speed: this.speedState }
  }

  get progress(): number {
    return this.progressState
  }

  get playing(): boolean {
    return this.playingState
  }

  get speed(): number {
    return this.speedState
  }

  /** 当前快照（useSyncExternalStore 的 getSnapshot） */
  getSnapshot = (): ReplaySnapshot => {
    return this.snapshotCache
  }

  /** 订阅快照变化（useSyncExternalStore 的 subscribe）；返回退订函数 */
  subscribe = (listener: SnapshotListener): (() => void) => {
    this.snapshotListeners.add(listener)
    return () => {
      this.snapshotListeners.delete(listener)
    }
  }

  /** 订阅帧级广播；返回退订函数 */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  /** 播放（末尾时自动归零重播） */
  play(): void {
    if (this.playingState) {
      return
    }
    if (this.progressState >= 1) {
      this.progressState = 0
    }
    this.playingState = true
    this.lastTick = null
    this.publishSnapshot()
    this.startLoop()
  }

  /** 暂停 */
  pause(): void {
    if (!this.playingState) {
      return
    }
    this.playingState = false
    this.stopLoop()
    this.publishSnapshot()
  }

  /** 播放/暂停切换 */
  toggle(): void {
    if (this.playingState) {
      this.pause()
    } else {
      this.play()
    }
  }

  /** 切换倍速（播放中即时生效，无需重启循环） */
  setSpeed(speed: number): void {
    if (speed === this.speedState) {
      return
    }
    this.speedState = speed
    this.publishSnapshot()
  }

  /**
   * 跳转到指定进度（0~1）。立即广播一帧 + 快照：
   * 暂停态拖动滑块时覆盖层（光标/已走轨迹/镜头）也能实时对齐。
   */
  seek(progress: number): void {
    const clamped = Math.min(Math.max(progress, 0), 1)
    this.progressState = clamped
    this.emitFrame()
    this.publishSnapshot()
  }

  /** 停止循环并清空订阅（组件卸载/points 变更时调用） */
  dispose(): void {
    this.playingState = false
    this.stopLoop()
    this.frameListeners.clear()
    this.snapshotListeners.clear()
  }

  private startLoop(): void {
    this.stopLoop()
    this.lastTick = null
    this.lastSync = 0
    this.rafId = requestAnimationFrame(this.tick)
  }

  private stopLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  /** 唯一的 rAF 循环：推进权威进度 → 帧级广播 → 节流快照 */
  private tick = (now: number): void => {
    if (!this.playingState) {
      return
    }
    // 首帧仅记录基准时钟（rAF 时间戳与 performance.now() 可能不同源，防负 dt）
    if (this.lastTick === null) {
      this.lastTick = now
      this.rafId = requestAnimationFrame(this.tick)
      return
    }
    const dt = Math.min((now - this.lastTick) / 1000, this.maxFrameDtSeconds)
    this.lastTick = now
    // dt 秒真实时间 × 倍速 = 推进的骑行时间；除以总时长得进度增量
    this.progressState = Math.min(this.progressState + (dt * this.speedState) / this.totalSpan, 1)
    this.emitFrame()
    if (this.progressState >= 1) {
      // 播完：终态帧 + 快照后自动暂停
      this.playingState = false
      this.stopLoop()
      this.publishSnapshot()
      return
    }
    if (now - this.lastSync >= this.syncIntervalMs) {
      this.lastSync = now
      this.publishSnapshot()
    }
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 计算当前帧并广播给覆盖层订阅者 */
  private emitFrame(): void {
    if (this.frameListeners.size === 0) {
      return
    }
    const ts = this.firstTs + this.progressState * this.totalSpan
    const index = findIndexAtTimestamp(this.points, ts)
    // findIndexAtTimestamp 对两点之间的时刻返回右端点（首个 ts >= 目标的点），
    // 而插值段应为 [左端点, 右端点]：左移一位才能让 t ∈ (0,1) 真正生效，
    // 否则插值被钳到 0、光标退化为逐点跳动（旧实现即败于此）
    const left = Math.max(index - 1, 0)
    const pt = interpolatePositionAt(this.points, left, ts)
    const frame: ReplayFrame = {
      progress: this.progressState,
      index,
      latitude: pt.latitude,
      longitude: pt.longitude,
    }
    for (const listener of this.frameListeners) {
      try {
        listener(frame)
      } catch (error) {
        // 单个订阅者异常不杀循环：全屏过渡期容器 0 尺寸、动画被打断等瞬态
        // 错误若向上抛出会永久终止 rAF，表现为「播放中卡死后再也不动」
        console.error('Replay frame listener error', error)
      }
    }
  }

  /** 替换不可变快照并通知 React 订阅者 */
  private publishSnapshot(): void {
    this.snapshotCache = {
      progress: this.progressState,
      playing: this.playingState,
      speed: this.speedState,
    }
    for (const listener of this.snapshotListeners) {
      listener(this.snapshotCache)
    }
  }
}
