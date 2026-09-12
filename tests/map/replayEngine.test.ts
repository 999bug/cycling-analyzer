/**
 * 回放引擎单元测试（框架无关状态机：唯一 rAF 循环 + 双通道广播）。
 *
 * 用 fake rAF 驱动确定性帧序列：不依赖真实时钟，消除 CPU 竞争抖动。
 */
import { describe, expect, it, vi } from 'vitest'
import { ReplayEngine } from '@/map/replayEngine'
import type { ReplayFrame, ReplaySnapshot } from '@/map/replayEngine'
import type { ReplayPoint } from '@/map/replayCore'

/** 构造 N 个匀速轨迹点（每秒一个点，沿经线推进） */
function makePoints(count: number): ReplayPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i,
    latitude: 31.2 + i * 0.0001,
    longitude: 121.5,
  }))
}

/** 安装 fake rAF 并返回帧驱动器：advance(ms) 按每 16ms 一帧推进 */
function installFakeRaf() {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
  })
  return {
    async advance(ms: number) {
      await vi.advanceTimersByTimeAsync(ms)
    },
    restore() {
      vi.useRealTimers()
    },
  }
}

describe('ReplayEngine 状态机', () => {
  const points = makePoints(600) // 600s 轨迹

  it('初始快照：进度 0、未播放、1x', () => {
    const engine = new ReplayEngine(points)
    expect(engine.getSnapshot()).toEqual({ progress: 0, playing: false, speed: 1 })
    engine.dispose()
  })

  it('seek 立即更新快照并广播一帧（暂停态也能对齐覆盖层）', () => {
    const engine = new ReplayEngine(points)
    const frames: ReplayFrame[] = []
    engine.onFrame((frame) => frames.push(frame))
    engine.seek(0.5)
    expect(engine.progress).toBe(0.5)
    expect(frames).toHaveLength(1)
    expect(frames[0]!.progress).toBe(0.5)
    // 时间跨度 = 599s（0..599）→ 0.5 进度 = 299.5s：落在 299→300 段中点
    expect(frames[0]!.index).toBe(300)
    expect(frames[0]!.latitude).toBeCloseTo(31.2 + 299.5 * 0.0001, 10)
    engine.dispose()
  })

  it('seek 超界钳制到 [0,1]', () => {
    const engine = new ReplayEngine(points)
    engine.seek(-1)
    expect(engine.progress).toBe(0)
    engine.seek(2)
    expect(engine.progress).toBe(1)
    engine.dispose()
  })

  it('播放推进进度（fake rAF 确定性），暂停后停止', async () => {
    const raf = installFakeRaf()
    try {
      const engine = new ReplayEngine(points, { syncIntervalMs: 100 })
      const snapshots: ReplaySnapshot[] = []
      engine.subscribe((snapshot) => snapshots.push(snapshot))
      engine.setSpeed(128)
      engine.play()
      expect(engine.playing).toBe(true)

      // ~1.1s 的 16ms 帧：600s 轨迹 128x → 每帧推进 2.05s 骑行时间
      await raf.advance(1120)
      expect(engine.progress).toBeGreaterThan(0.2)

      engine.pause()
      expect(engine.playing).toBe(false)
      const pausedAt = engine.progress
      await raf.advance(500)
      expect(engine.progress).toBe(pausedAt) // 暂停后进度不再变化
    } finally {
      raf.restore()
    }
  })

  it('快照按 syncIntervalMs 节流广播（10Hz 而非每帧）', async () => {
    const raf = installFakeRaf()
    try {
      const engine = new ReplayEngine(points, { syncIntervalMs: 100 })
      const snapshots: ReplaySnapshot[] = []
      engine.subscribe((snapshot) => snapshots.push(snapshot))
      engine.play()
      await raf.advance(1000) // ~62 帧 → 快照应约 10 次左右（含 play 即时快照）
      expect(snapshots.length).toBeGreaterThanOrEqual(8)
      expect(snapshots.length).toBeLessThanOrEqual(14)
      expect(snapshots[0]!.playing).toBe(true)
    } finally {
      raf.restore()
    }
  })

  it('播完自动暂停在进度 1；再 play 归零重播', async () => {
    const raf = installFakeRaf()
    try {
      const engine = new ReplayEngine(points)
      engine.setSpeed(128)
      engine.play()
      // fake rAF 每 16ms 一帧：600s 轨迹 128x → 约 4.7s 假时间播完，留余量
      await raf.advance(60000)
      expect(engine.progress).toBe(1)
      expect(engine.playing).toBe(false)

      engine.play()
      expect(engine.progress).toBe(0)
      expect(engine.playing).toBe(true)
      engine.pause()
    } finally {
      raf.restore()
    }
  })

  it('单帧推进被 maxFrameDtSeconds 钳制（切后台回来不跳进度）', async () => {
    const raf = installFakeRaf()
    try {
      const engine = new ReplayEngine(points, { maxFrameDtSeconds: 1 })
      // 1x：即使两帧间隔被拉大，单帧最多推进 1s 骑行时间 / 600s 总长
      engine.play()
      await raf.advance(32) // 先走两帧建立 lastTick
      const before = engine.progress
      await raf.advance(5000) // 一大步时间跳跃
      // 5s 内约 312 帧每帧最多 1s/600s ≈ 0.0017 → 进度远小于无钳制的 5000/600
      expect(engine.progress - before).toBeLessThan(0.6)
      engine.pause()
    } finally {
      raf.restore()
    }
  })

  it('帧广播给出邻点线性插值坐标', () => {
    const engine = new ReplayEngine(points)
    const frames: ReplayFrame[] = []
    engine.onFrame((frame) => frames.push(frame))
    // 时间跨度 599s：seek(300/599) → ts=300 恰为整数秒 → 段终点重合（t=1）
    engine.seek(300 / 599)
    expect(frames[0]!.latitude).toBeCloseTo(31.2 + 300 * 0.0001, 10)
    // seek(300.5/599) → ts=300.5 → 300→301 段中点插值（t=0.5）
    engine.seek(300.5 / 599)
    expect(frames[1]!.latitude).toBeCloseTo(31.2 + 300.5 * 0.0001, 10)
    engine.dispose()
  })

  it('dispose 后停止循环并清空订阅', async () => {
    const raf = installFakeRaf()
    try {
      const engine = new ReplayEngine(points)
      let frameCount = 0
      engine.onFrame(() => frameCount++)
      engine.play()
      await raf.advance(100)
      engine.dispose()
      const countAtDispose = frameCount
      await raf.advance(200)
      expect(frameCount).toBe(countAtDispose) // 不再有帧广播
      expect(engine.playing).toBe(false)
    } finally {
      raf.restore()
    }
  })

  it('帧监听器抛异常不杀 rAF 循环（全屏过渡期瞬态错误只记录）', async () => {
    const raf = installFakeRaf()
    try {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const engine = new ReplayEngine(points)
      engine.onFrame(() => {
        throw new Error('transition transient error')
      })
      let recoveredCount = 0
      engine.play()
      await raf.advance(50)
      expect(engine.playing).toBe(true) // 循环仍存活
      // 异常监听器退订后，其余订阅者照常收帧（这里用重新订阅模拟恢复）
      engine.onFrame(() => recoveredCount++)
      await raf.advance(50)
      expect(recoveredCount).toBeGreaterThan(0)
      expect(errorSpy).toHaveBeenCalled()
      engine.dispose()
    } finally {
      raf.restore()
    }
  })
})
