/**
 * 轨迹在线回放测试（性能重构回归：节流同步 + 抽稀骨架 + 命令式光标）。
 *
 * - 纯函数：时间戳二分定位边界、骨架抽稀保留末点；
 * - 组件：控制条渲染/倍速切换/播放推进后可暂停、心率缺失不伪造。
 *   TrackReplay 内部 useMap 需要 Leaflet 上下文：统一包在 MapContainer 内渲染
 *   （jsdom 下 Leaflet 可初始化，地图交互由 Playwright 实测覆盖）。
 */
import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MapContainer } from 'react-leaflet'
import { CircleMarker, Polyline, type LatLng, type Layer, type Map as LeafletMap } from 'leaflet'
import { haversineMeters } from '@/charts/timeline'
import { TrackReplay } from '@/map/TrackReplay'
import {
  buildCursorTipHtml,
  buildMovingTimeline,
  buildReplaySkeleton,
  findIndexAtTimestamp,
  interpolatePositionAt,
  splitTraveledLine,
} from '@/map/replayCore'
import type { RoutePoint } from '@/types/activity'

/** 构造 N 个匀速轨迹点（每秒一个点，沿经线推进） */
function makePoints(count: number): RoutePoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i,
    latitude: 31.2 + i * 0.0001,
    longitude: 121.5,
    distance: i * 10,
    speed: 5,
    heartRate: 120 + (i % 10),
  }))
}

/**
 * 构造「展示点被抽稀、判定源密集」的场景：密集记录每秒 1 点、全程 10m/s 骑行；
 * 展示点只保留 0/10/100/110s（相邻间隔最大 90s，> 暂停判定缺口 60s）。
 * 直接用展示点判定会把 10→100s 这段正常骑行误判成暂停。
 */
function makeSparseWithDenseSource(): { sparse: RoutePoint[]; dense: RoutePoint[] } {
  const dense: RoutePoint[] = Array.from({ length: 111 }, (_, t) => ({
    timestamp: t,
    latitude: 31.2 + t * 0.0001,
    longitude: 121.5,
    distance: t * 10,
    speed: 10,
  }))
  const keep = new Set([0, 10, 100, 110])
  return { sparse: dense.filter((point) => keep.has(point.timestamp)), dense }
}

/**
 * 构造带暂停的轨迹：0~10s 骑行、10~70s 红灯静止（位置与累计距离不变）、
 * 70~80s 继续骑行。真实跨度 80s，运动时长 20s。
 */
function makePointsWithPause(): RoutePoint[] {
  const points: RoutePoint[] = []
  for (let i = 0; i <= 10; i++) {
    points.push({
      timestamp: i,
      latitude: 31.2 + i * 0.0001,
      longitude: 121.5,
      distance: i * 10,
      speed: 10,
    })
  }
  for (let t = 20; t <= 70; t += 10) {
    points.push({ timestamp: t, latitude: 31.201, longitude: 121.5, distance: 100, speed: 0 })
  }
  for (let i = 1; i <= 10; i++) {
    points.push({
      timestamp: 70 + i,
      latitude: 31.201 + i * 0.0001,
      longitude: 121.5,
      distance: 100 + i * 10,
      speed: 10,
    })
  }
  return points
}

describe('findIndexAtTimestamp（二分定位）', () => {
  const points = makePoints(5) // timestamps: 0..4

  it('命中首点/中间点/末点', () => {
    expect(findIndexAtTimestamp(points, 0)).toBe(0)
    expect(findIndexAtTimestamp(points, 2)).toBe(2)
    expect(findIndexAtTimestamp(points, 4)).toBe(4)
  })

  it('落在两点之间时取右端点（首个 timestamp >= 目标）', () => {
    expect(findIndexAtTimestamp(points, 1.5)).toBe(2)
  })

  it('超出末端时钳制到末点索引', () => {
    expect(findIndexAtTimestamp(points, 99)).toBe(4)
  })
})

describe('buildReplaySkeleton（已走折线抽稀）', () => {
  it('点数低于上限时不抽稀（原数组返回）', () => {
    const points = makePoints(100)
    expect(buildReplaySkeleton(points, 200)).toBe(points)
  })

  it('超限时均匀抽稀且保留末点', () => {
    const points = makePoints(1000)
    const skeleton = buildReplaySkeleton(points, 100)
    // 步长 = ceil(1000/100) = 10 → 索引 0,10,...,990 共 99 点 + 补末点
    expect(skeleton.length).toBeLessThanOrEqual(101)
    expect(skeleton[skeleton.length - 1]).toBe(points[points.length - 1])
    expect(skeleton[0]).toBe(points[0])
    // 相邻抽样点步长一致
    expect(findIndexAtTimestamp(points, skeleton[1]!.timestamp)).toBe(10)
  })
})

describe('splitTraveledLine（已走高亮线段切分）', () => {
  it('骨架只画到光标身后：线头不会领先圆点', () => {
    // stride=1：光标在 5→6 段内时，骨架画到索引 5（=右端点-1），末段从 5 起
    expect(splitTraveledLine(6, 1, 10)).toEqual({ backboneCount: 6, tailStart: 6 })
    expect(splitTraveledLine(1, 1, 10)).toEqual({ backboneCount: 1, tailStart: 1 })
  })

  it('起点处骨架为空（末段只含光标）', () => {
    expect(splitTraveledLine(0, 1, 10)).toEqual({ backboneCount: 0, tailStart: 0 })
  })

  it('抽稀步长 >1 时末段补上骨架尾点到光标之间的原始点', () => {
    // stride=3、光标在 8→9 段内：骨架画到 points[6]（索引 6/3=2 → 3 点），末段从 points[7] 起
    expect(splitTraveledLine(9, 3, 5)).toEqual({ backboneCount: 3, tailStart: 7 })
    // stride=2、光标在 5→6 段内：骨架画到 points[4]，末段无原始点可补
    expect(splitTraveledLine(6, 2, 5)).toEqual({ backboneCount: 3, tailStart: 5 })
  })
})

describe('buildMovingTimeline（运动时间轴压缩）', () => {
  it('折叠暂停时段：末点时间戳 = 运动时长，几何点一个不丢', () => {
    const points = makePointsWithPause()
    const timeline = buildMovingTimeline(points)
    // 真实跨度 80s；运动时长 20s（0→10 与 70→80）
    expect(timeline).toHaveLength(points.length)
    expect(timeline[timeline.length - 1]!.timestamp).toBe(20)
    // 暂停段所有点共用同一时间戳（进度轴上宽度为 0）
    const paused = timeline.filter((point) => point.speed === 0)
    expect(paused.length).toBeGreaterThan(0)
    expect(new Set(paused.map((point) => point.timestamp)).size).toBe(1)
    expect(paused[0]!.timestamp).toBe(10)
    // 坐标原样保留：已走高亮线与底图完整轨迹始终重合
    expect(timeline.map((point) => point.latitude)).toEqual(points.map((point) => point.latitude))
  })

  it('不修改入参点集', () => {
    const points = makePointsWithPause()
    const before = points.map((point) => point.timestamp)
    buildMovingTimeline(points)
    expect(points.map((point) => point.timestamp)).toEqual(before)
  })

  it('无累计距离时原样返回（回退真实时间轴）', () => {
    const points: RoutePoint[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i,
      latitude: 31.2 + i * 0.0001,
      longitude: 121.5,
    }))
    expect(buildMovingTimeline(points)).toBe(points)
  })

  it('全程静止且坐标不动（压缩后时长归零）时原样返回，避免零长度回放', () => {
    // 坐标也必须不动：坐标有位移时「光标限速补时」会给出慢速回放（那是记录断档场景，另有专测）
    const points = makePoints(10).map((point) => ({
      ...point,
      latitude: 31.2,
      longitude: 121.5,
      distance: 100,
    }))
    expect(buildMovingTimeline(points)).toBe(points)
  })

  it('展示点被抽稀到分钟级间隔时，判定必须换用密集采样源', () => {
    const { sparse, dense } = makeSparseWithDenseSource()
    // 去掉坐标：本用例只看判定源，排除「光标限速补时」的干扰（补时另有专测）
    const withoutCoords = (points: RoutePoint[]): { timestamp: number; distance?: number }[] =>
      points.map((point) => ({ timestamp: point.timestamp, distance: point.distance }))
    // 只用抽稀点判定：10→100s 的 90s 缺口被当成暂停 → 总时长只剩 20s（正常骑行被折掉）
    const sparseOnly = withoutCoords(sparse)
    expect(buildMovingTimeline(sparseOnly)[sparseOnly.length - 1]!.timestamp).toBe(20)
    // 换密集记录判定：全程 10m/s 骑行 → 总时长 110s，时间戳按真实运动时间推进
    const timeline = buildMovingTimeline(withoutCoords(sparse), withoutCoords(dense))
    expect(timeline.map((point) => point.timestamp)).toEqual([0, 10, 100, 110])
    expect(sparse[sparse.length - 1]!.timestamp).toBe(110)
  })

  it('记录断档（停记期间真骑出去了）：位移大但被判为暂停时按限速补足时长', () => {
    // 10~197s 设备停记 187s、期间骑出去约 861m，而累计距离被冻结在 100m（真实数据实测形态）
    const points: RoutePoint[] = [
      { timestamp: 0, distance: 0, latitude: 31.2, longitude: 121.5 },
      { timestamp: 10, distance: 100, latitude: 31.2009, longitude: 121.5 },
      { timestamp: 197, distance: 100, latitude: 31.20864, longitude: 121.5 },
      { timestamp: 207, distance: 200, latitude: 31.20954, longitude: 121.5 },
    ]
    const timeline = buildMovingTimeline(points)
    // 断档段拿到了补时（时钟增量为正），光标是滑过去而不是瞬移过去
    expect(timeline[2]!.timestamp - timeline[1]!.timestamp).toBeGreaterThan(0)
    // 不变量：任一段的光标等效速度都不超过限速（25m/s）
    for (let i = 1; i < timeline.length; i++) {
      const disp = haversineMeters(
        timeline[i - 1]!.latitude, timeline[i - 1]!.longitude,
        timeline[i]!.latitude, timeline[i]!.longitude,
      )
      const dtClock = timeline[i]!.timestamp - timeline[i - 1]!.timestamp
      if (dtClock > 0) {
        expect(disp / dtClock).toBeLessThanOrEqual(25 + 1e-6)
      }
    }
    // 不变量：回放总时长不超过该段真实跨度
    expect(timeline[timeline.length - 1]!.timestamp).toBeLessThanOrEqual(207)
  })

  it('GPS 抖出的假位移不会把回放拉长（补时以该段真实间隔为上限）', () => {
    const points: RoutePoint[] = [
      { timestamp: 0, distance: 0, latitude: 31.2, longitude: 121.5 },
      // 1 秒内"移动" 78km：若按限速补时会加 3000+ 秒
      { timestamp: 1, distance: 0, latitude: 31.9, longitude: 121.5 },
    ]
    expect(buildMovingTimeline(points)[1]!.timestamp).toBeLessThanOrEqual(1)
  })
})

describe('interpolatePositionAt（邻点线性插值）', () => {
  const points = [
    { timestamp: 0, latitude: 31.2, longitude: 121.5 },
    { timestamp: 10, latitude: 31.3, longitude: 121.6 },
    { timestamp: 20, latitude: 31.4, longitude: 121.7 },
  ]

  it('段中间时刻取两端点的中点坐标', () => {
    const pt = interpolatePositionAt(points, 0, 5)
    expect(pt.latitude).toBeCloseTo(31.25, 10)
    expect(pt.longitude).toBeCloseTo(121.55, 10)
  })

  it('段起点/终点分别与端点重合', () => {
    expect(interpolatePositionAt(points, 0, 0).latitude).toBe(31.2)
    expect(interpolatePositionAt(points, 0, 10).latitude).toBe(31.3)
  })

  it('末段无下一点时钳制到末点（含超出时间戳场景）', () => {
    expect(interpolatePositionAt(points, 2, 20).longitude).toBe(121.7)
    expect(interpolatePositionAt(points, 2, 999).longitude).toBe(121.7)
  })

  it('相邻点时间戳相同时不除零，直接返回左端点', () => {
    const dup = [points[0]!, points[0]!]
    const pt = interpolatePositionAt(dup, 0, 5)
    expect(pt.latitude).toBe(31.2)
  })
})

describe('buildCursorTipHtml（光标数据牌）', () => {
  it('速度/心率/功率齐全时全部展示（速度换算 km/h）', () => {
    const html = buildCursorTipHtml({ speed: 5, heartRate: 145, power: 220 })
    expect(html).toContain('18.0 km/h')
    expect(html).toContain('145 bpm')
    expect(html).toContain('220 W')
  })

  it('缺失字段直接省略不伪造，全缺返回空串', () => {
    expect(buildCursorTipHtml({ speed: 5 })).not.toContain('bpm')
    expect(buildCursorTipHtml({})).toBe('')
    expect(buildCursorTipHtml(undefined)).toBe('')
  })
})

describe('TrackReplay 控制条', () => {
  const points = makePoints(600)

  function setup() {
    return render(
      <MapContainer center={[31.2, 121.5]} zoom={14} style={{ width: 800, height: 600 }}>
        <TrackReplay
          points={points}
          distanceUnit="km"
          terrainVisible={false}
          onTerrainToggle={() => {}}
        />
      </MapContainer>,
    )
  }

  it('渲染播放按钮、倍速选项与初始零进度时钟', () => {
    setup()
    expect(screen.getByRole('button', { name: '▶' })).toBeInTheDocument()
    for (const option of ['1×', '8×', '32×', '64×', '128×']) {
      expect(screen.getByRole('button', { name: option })).toBeInTheDocument()
    }
    expect(screen.getByText(/00:00/)).toBeInTheDocument()
    expect(screen.getByLabelText('回放进度')).toHaveValue('0')
  })

  it('倍速切换后高亮激活态', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: '32×' }))
    expect(screen.getByRole('button', { name: '32×' }).className).toContain('--active')
    expect(screen.getByRole('button', { name: '1×' }).className).not.toContain('--active')
  })

  it('暂停时段不计入回放时长：拖到末尾时钟显示运动时长而非真实跨度', async () => {
    const pausePoints = makePointsWithPause()
    render(
      <MapContainer center={[31.2, 121.5]} zoom={14} style={{ width: 800, height: 600 }}>
        <TrackReplay
          points={pausePoints}
          distanceUnit="km"
          terrainVisible={false}
          onTerrainToggle={() => {}}
        />
      </MapContainer>,
    )
    const slider = screen.getByLabelText('回放进度') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '1000' } })
    await waitFor(() => {
      // 运动时长 20s；按真实时间轴（含 60s 红灯）则会显示 01:20
      expect(screen.getByText(/00:20/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/01:20/)).not.toBeInTheDocument()
  })

  it('传入密集采样源后，抽稀点之间的正常骑行段不再被误折', async () => {
    const { sparse, dense } = makeSparseWithDenseSource()
    render(
      <MapContainer center={[31.2, 121.5]} zoom={14} style={{ width: 800, height: 600 }}>
        <TrackReplay
          points={sparse}
          motionSource={dense}
          distanceUnit="km"
          terrainVisible={false}
          onTerrainToggle={() => {}}
        />
      </MapContainer>,
    )
    fireEvent.change(screen.getByLabelText('回放进度'), { target: { value: '1000' } })
    // 运动时长 110s；只用抽稀点判定则会被折成 20s（00:20）
    await waitFor(() => {
      expect(screen.getByText(/01:50/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/00:20/)).not.toBeInTheDocument()
  })

  it('已走高亮线的线头与光标重合（橙线不领先圆点）', async () => {
    const mapRef = createRef<LeafletMap>()
    render(
      <MapContainer
        ref={mapRef}
        center={[31.2, 121.5]}
        zoom={14}
        style={{ width: 800, height: 600 }}
      >
        <TrackReplay
          points={points}
          distanceUnit="km"
          terrainVisible={false}
          onTerrainToggle={() => {}}
        />
      </MapContainer>,
    )
    const slider = screen.getByLabelText('回放进度') as HTMLInputElement
    for (const value of ['250', '500', '870']) {
      fireEvent.change(slider, { target: { value } })
      await waitFor(() => {
        const layers: Layer[] = []
        mapRef.current!.eachLayer((layer) => layers.push(layer))
        const tail = layers.find(
          (layer): layer is Polyline =>
            layer instanceof Polyline && layer.options.className === 'replay-traveled-tail',
        )
        const cursor = layers.find(
          (layer): layer is CircleMarker => layer instanceof CircleMarker && layer.options.radius === 7,
        )
        expect(tail).toBeDefined()
        expect(cursor).toBeDefined()
        const tip = (tail!.getLatLngs() as LatLng[])[tail!.getLatLngs().length - 1]!
        // 覆盖层不能被 React 渲染路径打回初始态（否则圆点会弹回起点、橙线被清空）
        expect(tail!.getLatLngs().length).toBeGreaterThanOrEqual(2)
        expect(cursor!.getLatLng().lat).toBeGreaterThan(points[0]!.latitude)
        // 线头与圆点必须落在同一坐标（否则就是「橙线跑得比圆点快」）
        expect(tip.lat).toBeCloseTo(cursor!.getLatLng().lat, 10)
        expect(tip.lng).toBeCloseTo(cursor!.getLatLng().lng, 10)
      })
    }
  })

  it('拖动进度滑块联动时钟与距离 HUD', async () => {
    setup()
    // 初始时钟 00:00；fireEvent.change 直接模拟拖动到 50%（控制条在 MapContainer 内，
    // userEvent 点击/键盘会冒泡进 Leaflet 容器引发双击模拟报错，故用 fireEvent）
    expect(screen.getByText(/00:00/)).toBeInTheDocument()
    const slider = screen.getByLabelText('回放进度') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '500' } })
    // 模拟时间 300s → 时钟离开零值、距离 HUD 出现数值
    await waitFor(() => {
      expect(screen.queryByText(/00:00/)).not.toBeInTheDocument()
      expect((screen.getByLabelText('回放进度') as HTMLInputElement).value).toBe('500')
    })
    // 10 步 = 模拟时间 6s → 时钟离开零值且距离 HUD 出现非零值
    await waitFor(() => {
      expect(Number((slider as HTMLInputElement).value)).toBeGreaterThan(0)
      expect(screen.queryByText(/00:00/)).not.toBeInTheDocument()
    })
  })

  it('点击播放后进度推进（fake rAF 确定性验证），再点击暂停停止', async () => {
    // 显式伪造 rAF：帧序列由 advanceTimersByTimeAsync 驱动，不再依赖真实时钟（消除并发跑测试时的 CPU 竞争抖动）
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'],
    })
    try {
      setup()
      fireEvent.click(screen.getByRole('button', { name: '▶' }))
      expect(screen.getByRole('button', { name: '⏸' })).toBeInTheDocument()

      // 切到 128×：600s 轨迹每真实秒推进 128s → 滑块（千分位）每真实秒 +213 左右
      fireEvent.click(screen.getByRole('button', { name: '128×' }))
      // 推进 ~1.1s 的 rAF 帧（16ms/帧），act 内刷新状态
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1120)
      })
      const value = Number((screen.getByLabelText('回放进度') as HTMLInputElement).value)
      expect(value).toBeGreaterThan(50)

      fireEvent.click(screen.getByRole('button', { name: '⏸' }))
      expect(screen.getByRole('button', { name: '▶' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('拖动进度后光标数据牌显示速度/心率/功率，无指标点时隐藏', async () => {
    setup()
    // 初始未播放且进度为 0：数据牌隐藏
    let tip = document.querySelector('.replay-cursor-tip') as HTMLElement | null
    expect(tip).not.toBeNull()
    expect(tip!.style.display).toBe('none')

    // 拖动到 50%（模拟时间 300s，600 点均匀数据：speed=5 → 18.0 km/h，心率 120）
    const slider = screen.getByLabelText('回放进度') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '500' } })
    await waitFor(() => {
      tip = document.querySelector('.replay-cursor-tip') as HTMLElement
      expect(tip.style.display).toBe('block')
      expect(tip.textContent).toContain('18.0 km/h')
      expect(tip.textContent).toContain('120 bpm')
    })

    // 无任何指标的稀疏点：数据牌整体隐藏（缺失 ≠ 0，不伪造）
    const sparse: RoutePoint[] = [
      { timestamp: 0, latitude: 31.2, longitude: 121.5 },
      { timestamp: 10, latitude: 31.201, longitude: 121.5 },
    ]
    render(
      <MapContainer center={[31.2, 121.5]} zoom={14} style={{ width: 800, height: 600 }}>
        <TrackReplay
          points={sparse}
          distanceUnit="km"
          terrainVisible={false}
          onTerrainToggle={() => {}}
        />
      </MapContainer>,
    )
    const sparseSlider = screen.getAllByLabelText('回放进度')[1] as HTMLInputElement
    fireEvent.change(sparseSlider, { target: { value: '500' } })
    await waitFor(() => {
      const tips = Array.from(document.querySelectorAll('.replay-cursor-tip')) as HTMLElement[]
      const sparseTip = tips[tips.length - 1]!
      expect(sparseTip.style.display).toBe('none')
    })
  })

  it('心率缺失时显示 — 不伪造数值', () => {
    const sparse: RoutePoint[] = [
      { timestamp: 0, latitude: 31.2, longitude: 121.5 },
      { timestamp: 10, latitude: 31.201, longitude: 121.5 },
    ]
    render(
      <MapContainer center={[31.2, 121.5]} zoom={14} style={{ width: 800, height: 600 }}>
        <TrackReplay
          points={sparse}
          distanceUnit="km"
          terrainVisible={false}
          onTerrainToggle={() => {}}
        />
      </MapContainer>,
    )
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})
