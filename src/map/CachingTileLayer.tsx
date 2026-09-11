/**
 * 瓦片缓存图层（离线地图）。
 *
 * 覆写 Leaflet TileLayer.createTile 为异步模式：
 * 1. 查 IndexedDB 缓存命中 → 用 Blob URL 直接显示（离线可用）
 * 2. 未命中 → fetch 瓦片（cors）→ 写入缓存 → Blob URL 显示
 * 3. fetch 失败（网络/CORS）→ 回退原生 <img> 加载（不缓存），
 *    让 tileerror 正常触发，既有「OSM→高德」降级逻辑不受影响。
 *
 * 用 react-leaflet 的 createTileLayerComponent 包装，替换既有 TileLayer。
 *
 * `allowLocalTile` 开关（2026-09-10 修卫星底图 bug）：`public/author-data/tiles/`
 * 只预缓存了**矢量底图**瓦片（清单 key 为 "z/x/y"，不含底图模式），若卫星请求也走
 * 「本地预缓存优先」，作者数据区域切卫星后旧视口那片会显示路网图、其余显示真卫星。
 * 因此非「正常」模式的图层一律传 false，直接走在线瓦片。
 */
import { createElementObject, createTileLayerComponent, updateGridLayer, withPane, type LayerProps } from '@react-leaflet/core'
import { TileLayer as LeafletTileLayer, type Coords, type DoneCallback, type TileLayerOptions } from 'leaflet'
import { db } from '@/storage/db'
import { getCachedTile, putCachedTile } from '@/storage/tileCache'
import { hasLocalTile, localTileUrl, parseAmapTileUrl } from '@/map/localTiles'

/**
 * 解析「本地预缓存优先」的瓦片坐标：开关关闭或非高德模板一律返回 null。
 *
 * @param url 已实例化的瓦片 URL
 * @param allowLocalTile 是否允许命中本地预缓存
 */
export function resolveLocalTileCoords(
  url: string,
  allowLocalTile: boolean,
): { z: number; x: number; y: number } | null {
  if (!allowLocalTile) {
    return null
  }
  return parseAmapTileUrl(url)
}

/**
 * 缓存优先的瓦片图层（Leaflet 层，供 createTileLayerComponent 使用）。
 *
 * createTile 定义为两个参数（coords, done）时 Leaflet 判定为异步瓦片，
 * 会等待 done 回调后再标记 ready——缓存读取/fetch 都可在此完成。
 */
export class CachingTileLayer extends LeafletTileLayer {
  /** 已创建的 Blob URL（tileunload 时 revoke，避免内存泄漏） */
  private readonly objectUrls = new WeakMap<HTMLElement, string>()

  /** 瓦片缓存开关（false 时退化为普通 TileLayer，直接原生加载） */
  private cacheEnabled: boolean

  /** 是否允许命中本地预缓存瓦片（仅矢量底图模式可用） */
  private allowLocalTile: boolean

  constructor(url: string, options?: object, cacheEnabled = true, allowLocalTile = true) {
    super(url, options)
    this.cacheEnabled = cacheEnabled
    this.allowLocalTile = allowLocalTile
    this.on('tileunload', this.handleTileUnload, this)
  }

  /**
   * 更新瓦片缓存开关。
   *
   * @param enabled 是否启用缓存
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled
  }

  /**
   * 更新「本地预缓存优先」开关。
   *
   * @param allow 是否允许命中本地预缓存
   */
  setAllowLocalTile(allow: boolean): void {
    this.allowLocalTile = allow
  }

  /**
   * 覆写 createTile：异步加载瓦片（缓存优先），返回 img 元素。
   *
   * @param coords 瓦片坐标
   * @param done 就绪回调（Leaflet 异步瓦片约定，成功传 null，失败传 Error）
   * @returns 瓦片 img 元素
   */
  override createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const tile = document.createElement('img')
    tile.alt = ''
    tile.setAttribute('role', 'presentation')
    // 跨域属性必须落在 img 上（Leaflet 的 options.crossOrigin 只在自己创建瓦片时生效，
    // 本类自己建 img，需显式同步）：Blob URL 用不到它，原生兜底加载则靠它保住画布不污染
    const crossOrigin = this.options.crossOrigin
    if (typeof crossOrigin === 'string') {
      tile.crossOrigin = crossOrigin
    } else if (crossOrigin === true) {
      tile.crossOrigin = 'anonymous'
    }
    tile.addEventListener('load', () => done(undefined, tile))
    tile.addEventListener('error', () => done(new Error('tile load failed'), tile))
    const url = this.getTileUrl(coords)
    void this.loadTile(tile, url)
    return tile
  }

  /**
   * 瓦片移除时回收 Blob URL。
   *
   * @param event tileunload 事件
   */
  private handleTileUnload(event: { tile: HTMLElement }): void {
    const objectUrl = this.objectUrls.get(event.tile)
    if (objectUrl !== undefined) {
      URL.revokeObjectURL(objectUrl)
      this.objectUrls.delete(event.tile)
    }
  }

  /**
   * 异步加载瓦片：本地清单与缓存并行查询 → 命中直出 / 未命中 fetch → 失败回退原生加载。
   *
   * 并行的原因：两路检查原本串行 await（清单首次还要先下 28KB manifest），
   * 会让在线 fetch 比原生 <img> 晚一大截才起步；并行后 fetch 起步延迟显著缩短。
   * 本地命中时多付一次 IndexedDB 读的代价（仅作者数据区域），可接受。
   *
   * @param tile 瓦片 img 元素
   * @param url 瓦片 URL
   */
  private async loadTile(tile: HTMLImageElement, url: string): Promise<void> {
    if (!this.cacheEnabled) {
      tile.src = url
      return
    }

    const amapCoords = resolveLocalTileCoords(url, this.allowLocalTile)
    const [isLocal, cached] = await Promise.all([
      amapCoords !== null
        ? hasLocalTile(amapCoords.z, amapCoords.x, amapCoords.y)
        : Promise.resolve(false),
      this.readCachedTile(url),
    ])

    // 预缓存静态瓦片优先（作者数据区域）：同域直读零跨域，命中则完全绕过在线请求。
    // 仅矢量底图模式开放——本地只预缓存了矢量瓦片，卫星/注记层查清单必然错拿矢量图
    if (isLocal && amapCoords !== null) {
      tile.src = localTileUrl(amapCoords.z, amapCoords.x, amapCoords.y)
      return
    }

    if (cached !== undefined) {
      this.setTileSource(tile, url, cached)
      return
    }

    try {
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const blob = await response.blob()
      // 空响应体不缓存（如 204）
      if (blob.size > 0) {
        void putCachedTile(db, url, blob).catch((error: unknown) => {
          console.error('Failed to write tile cache', error)
        })
      }
      this.setTileSource(tile, url, blob)
    } catch (error) {
      // fetch 失败（CORS/网络）：回退原生加载（不缓存），tileerror 触发降级
      console.warn('Tile fetch failed, falling back to native loading', url, error)
      tile.src = url
    }
  }

  /**
   * 读取 IndexedDB 瓦片缓存（失败视为未命中，不阻断在线加载）。
   *
   * @param url 瓦片 URL
   */
  private async readCachedTile(url: string): Promise<Blob | undefined> {
    try {
      return await getCachedTile(db, url)
    } catch (error) {
      console.error('Failed to read tile cache', error)
      return undefined
    }
  }

  /**
   * 用缓存 Blob 生成 Blob URL 并赋给瓦片（注册对象 URL 便于回收）。
   * 仅接受真正的 Blob（跨环境防御：IndexedDB 读回/边界情况可能不是 Blob），
   * 否则回退原生加载（tile.src = url），保证 tileerror 仍能触发降级。
   *
   * @param tile 瓦片 img 元素
   * @param url 原始瓦片 URL（回退时直接作为 img src）
   * @param blob 瓦片二进制
   */
  private setTileSource(tile: HTMLImageElement, url: string, blob: Blob): void {
    if (!(blob instanceof Blob)) {
      console.warn('Tile cache returned a non-Blob, falling back to native loading', url)
      tile.src = url
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    this.objectUrls.set(tile, objectUrl)
    tile.src = objectUrl
  }
}

/**
 * 瓦片缓存图层组件 props（与 react-leaflet TileLayer 同参，另加缓存开关）。
 */
export interface CachingTileLayerProps extends TileLayerOptions, LayerProps {
  /** 瓦片 URL 模板 */
  url: string

  /** 瓦片缓存开关（false 时退化为普通瓦片层） */
  cacheEnabled?: boolean

  /**
   * 是否允许命中本地预缓存瓦片（默认 true）。
   * 仅矢量底图（「正常」模式）为 true；卫星底图与透明注记层必须传 false。
   */
  allowLocalTile?: boolean
}

/**
 * 瓦片缓存图层 React 组件（createTileLayerComponent 包装）。
 *
 * 与 react-leaflet 的 TileLayer 同 API（url/subdomains/attribution），
 * 但走 IndexedDB 缓存；其余属性透传 Leaflet。
 */
export const CachingTileLayerComponent = createTileLayerComponent<
  CachingTileLayer,
  CachingTileLayerProps
>(
  function createCachingTileLayer(
    { url, cacheEnabled = true, allowLocalTile = true, ...options },
    context,
  ) {
    const layer = new CachingTileLayer(url, withPane(options, context), cacheEnabled, allowLocalTile)
    return createElementObject(layer, context)
  },
  function updateCachingTileLayer(layer, props, prevProps) {
    updateGridLayer(layer, props, prevProps)
    const { url } = props
    if (url != null && url !== prevProps.url) {
      layer.setUrl(url)
    }
    if (props.cacheEnabled !== prevProps.cacheEnabled) {
      layer.setCacheEnabled(props.cacheEnabled ?? true)
    }
    if (props.allowLocalTile !== prevProps.allowLocalTile) {
      layer.setAllowLocalTile(props.allowLocalTile ?? true)
      // 开关变化会影响已生成瓦片的来源（本地/在线），重绘一遍
      layer.redraw()
    }
  },
)