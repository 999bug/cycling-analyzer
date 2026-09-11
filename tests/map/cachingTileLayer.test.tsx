/**
 * 缓存瓦片层「本地预缓存优先」开关测试（2026-09-10 卫星底图 bug 回归）。
 *
 * 背景：`public/author-data/tiles/` 只预缓存了**矢量底图**瓦片，清单 key 为 "z/x/y"
 * 不含底图模式。若卫星请求也走本地预缓存优先，作者快照覆盖区域切卫星后会显示
 * 路网图（与其余区域的真卫星混杂）。因此非「正常」模式的图层必须传
 * `allowLocalTile: false`，直接走在线瓦片。
 *
 * 用真实 CachingTileLayer 实例 + 桩化 getTileUrl 验证调用链，
 * 而不是只测开关的形参传递。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CachingTileLayer, resolveLocalTileCoords } from '@/map/CachingTileLayer'
import type { Coords } from 'leaflet'

// tests/setup.ts 默认把本模块整体 mock 成空实现（避免全量渲染时真实发包），
// 本文件需要真实实现，故用 importOriginal 覆盖回原样。
vi.mock('@/map/CachingTileLayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/map/CachingTileLayer')>()
  return { ...actual }
})

const { hasLocalTileMock, localTileUrlMock } = vi.hoisted(() => ({
  hasLocalTileMock: vi.fn<(z: number, x: number, y: number) => Promise<boolean>>(async () => true),
  localTileUrlMock: vi.fn((z: number, x: number, y: number) => `/author-data/tiles/${z}/${x}/${y}.png`),
}))

// 桩化本地瓦片清单查询（真实实现会 fetch manifest）
vi.mock('@/map/localTiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/map/localTiles')>()
  return {
    ...actual,
    hasLocalTile: hasLocalTileMock,
    localTileUrl: localTileUrlMock,
  }
})

// 桩化 IndexedDB 瓦片缓存与 db 句柄（本测试只关心「本地预缓存优先」分支）
vi.mock('@/storage/tileCache', () => ({
  getCachedTile: vi.fn(async () => undefined),
  putCachedTile: vi.fn(async () => undefined),
}))
vi.mock('@/storage/db', () => ({ db: {} }))

/** 高德矢量底图瓦片 URL（x/y/z 顺序与模板一致） */
const AMAP_URL =
  'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=3&y=4&z=5'

const AMAP_TEMPLATE =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'

const COORDS = { x: 3, y: 4, z: 5 } as Coords

// fetch 一律失败：走「回退原生加载」路径，tile.src 落回在线 URL
const fetchMock = vi.fn(async () => {
  throw new Error('offline')
})

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/**
 * 用给定开关创建一个瓦片元素（getTileUrl 桩化，避免依赖真实 Leaflet 地图实例）。
 *
 * @param allowLocalTile 是否允许命中本地预缓存
 */
function createTileWith(allowLocalTile: boolean): HTMLImageElement {
  const layer = new CachingTileLayer(AMAP_TEMPLATE, {}, true, allowLocalTile)
  layer.getTileUrl = () => AMAP_URL
  return layer.createTile(COORDS, vi.fn()) as HTMLImageElement
}

describe('resolveLocalTileCoords 本地预缓存开关', () => {
  it('开关关闭时返回 null（不查清单，哪怕 URL 是高德模板）', () => {
    expect(resolveLocalTileCoords(AMAP_URL, false)).toBeNull()
  })

  it('开关开启时解析出高德瓦片坐标', () => {
    expect(resolveLocalTileCoords(AMAP_URL, true)).toEqual({ z: 5, x: 3, y: 4 })
  })

  it('非高德 URL 解析失败返回 null', () => {
    expect(resolveLocalTileCoords('https://a.tile.openstreetmap.org/5/3/4.png', true)).toBeNull()
  })
})

describe('缓存瓦片层本地预缓存优先', () => {
  it('正常模式：命中本地预缓存时直指本地瓦片，不发在线请求', async () => {
    const tile = createTileWith(true)

    await vi.waitFor(() => {
      expect(tile.getAttribute('src')).toBe('/author-data/tiles/5/3/4.png')
    })
    expect(hasLocalTileMock).toHaveBeenCalledWith(5, 3, 4)
    expect(localTileUrlMock).toHaveBeenCalledWith(5, 3, 4)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('卫星等非正常模式：跳过本地预缓存，直接走在线瓦片', async () => {
    const tile = createTileWith(false)

    await vi.waitFor(() => {
      expect(tile.getAttribute('src')).toBe(AMAP_URL)
    })
    expect(hasLocalTileMock).not.toHaveBeenCalled()
    expect(localTileUrlMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(AMAP_URL, { mode: 'cors' })
  })
})

describe('缓存瓦片层 crossOrigin 透传', () => {
  /**
   * 用指定 crossOrigin 选项创建瓦片元素。
   *
   * @param crossOrigin Leaflet TileLayer 的 crossOrigin 选项
   */
  function createTileWithCrossOrigin(crossOrigin?: boolean | string): HTMLImageElement {
    const layer = new CachingTileLayer(AMAP_TEMPLATE, { crossOrigin }, true, true)
    layer.getTileUrl = () => AMAP_URL
    return layer.createTile(COORDS, vi.fn()) as HTMLImageElement
  }

  it('crossOrigin: anonymous 时落在 img 上（底图画进 canvas 不被污染）', () => {
    expect(createTileWithCrossOrigin('anonymous').crossOrigin).toBe('anonymous')
  })

  it('crossOrigin: true 归一化为 anonymous', () => {
    expect(createTileWithCrossOrigin(true).crossOrigin).toBe('anonymous')
  })

  it('未开启时不加属性（保持既有行为）', () => {
    expect(createTileWithCrossOrigin().crossOrigin).toBeNull()
    expect(createTileWithCrossOrigin(false).crossOrigin).toBeNull()
  })
})
