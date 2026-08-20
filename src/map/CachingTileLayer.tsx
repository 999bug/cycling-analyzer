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
 */
import { createElementObject, createTileLayerComponent, updateGridLayer, withPane, type LayerProps } from '@react-leaflet/core'
import { TileLayer as LeafletTileLayer, type Coords, type DoneCallback, type TileLayerOptions } from 'leaflet'
import { db } from '@/storage/db'
import { getCachedTile, putCachedTile } from '@/storage/tileCache'

/**
 * 缓存优先的瓦片图层（Leaflet 层，供 createTileLayerComponent 使用）。
 *
 * createTile 定义为两个参数（coords, done）时 Leaflet 判定为异步瓦片，
 * 会等待 done 回调后再标记 ready——缓存读取/fetch 都可在此完成。
 */
class CachingTileLayer extends LeafletTileLayer {
  /** 已创建的 Blob URL（tileunload 时 revoke，避免内存泄漏） */
  private readonly objectUrls = new WeakMap<HTMLElement, string>()

  /** 瓦片缓存开关（false 时退化为普通 TileLayer，直接原生加载） */
  private cacheEnabled: boolean

  constructor(url: string, options?: object, cacheEnabled = true) {
    super(url, options)
    this.cacheEnabled = cacheEnabled
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
   * 异步加载瓦片：缓存命中 → 未命中 fetch → 失败回退原生加载。
   *
   * @param tile 瓦片 img 元素
   * @param url 瓦片 URL
   * @param done 就绪回调
   */
  private async loadTile(tile: HTMLImageElement, url: string): Promise<void> {
    if (!this.cacheEnabled) {
      tile.src = url
      return
    }

    try {
      const cached = await getCachedTile(db, url)
      if (cached !== undefined) {
        this.setTileSource(tile, url, cached)
        return
      }
    } catch (error) {
      console.error('Failed to read tile cache', error)
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
  function createCachingTileLayer({ url, cacheEnabled = true, ...options }, context) {
    const layer = new CachingTileLayer(url, withPane(options, context), cacheEnabled)
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
  },
)