/**
 * 预缓存瓦片清单（作者数据静态瓦片）。
 *
 * scripts/prefetch-tiles.mjs 把作者轨迹覆盖区域的高德瓦片预取到
 * public/author-data/tiles/{z}/{x}/{y}.png 并生成 tiles-manifest.json
 * （["z/x/y", ...]）。运行时懒加载清单一次（~28KB），高德源下 createTile
 * 命中清单则 src 直指本地同域路径：零跨域、零等待、HTTP 缓存友好；
 * 未命中走原有 IndexedDB → 在线 链路。
 *
 * 清单为空/加载失败时静默降级（所有瓦片走在线），不影响可用性。
 */

/** 本地瓦片目录的站点相对路径（BASE_URL 适配 GitHub Pages 子路径） */
const TILES_BASE = `${import.meta.env.BASE_URL}author-data/tiles/`

const MANIFEST_URL = `${import.meta.env.BASE_URL}author-data/tiles-manifest.json`

/** 模块级缓存：null = 未加载，Set = 已加载（"z/x/y" key） */
let manifest: Set<string> | null = null

/** 进行中的加载 Promise（并发去重） */
let loading: Promise<void> | undefined

/**
 * 确保清单已加载（幂等；失败静默降级为空集）。
 */
async function ensureManifest(): Promise<void> {
  if (manifest !== null) {
    return
  }
  loading ??= fetch(MANIFEST_URL)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const keys: unknown = await response.json()
      manifest = new Set(Array.isArray(keys) ? (keys as string[]) : [])
    })
    .catch((error: unknown) => {
      console.warn('Tile manifest unavailable, falling back to online tiles', error)
      manifest = new Set()
    })
  await loading
}

/**
 * 判断本地是否预缓存了该瓦片。
 *
 * @param z zoom 层级
 * @param x 瓦片 X
 * @param y 瓦片 Y
 */
export async function hasLocalTile(z: number, x: number, y: number): Promise<boolean> {
  await ensureManifest()
  return manifest?.has(`${z}/${x}/${y}`) ?? false
}

/**
 * 本地瓦片的站点绝对 URL。
 *
 * @param z zoom 层级
 * @param x 瓦片 X
 * @param y 瓦片 Y
 */
export function localTileUrl(z: number, x: number, y: number): string {
  return `${TILES_BASE}${z}/${x}/${y}.png`
}

/**
 * 从 Leaflet getTileUrl 生成的模板 URL 解析 z/x/y（子域占位符已替换）。
 *
 * 高德模板形如 ...&x=123&y=456&z=10；解析失败返回 null（非高德源等场景）。
 *
 * @param url 已实例化的瓦片 URL
 */
export function parseAmapTileUrl(url: string): { z: number; x: number; y: number } | null {
  const params = /(?:^|[?&])x=(\d+)&y=(\d+)&z=(\d+)/.exec(url)
  if (params === null) {
    return null
  }
  return { x: Number(params[1]), y: Number(params[2]), z: Number(params[3]) }
}

/** 测试辅助：重置模块级清单缓存 */
export function resetManifestForTest(): void {
  manifest = null
  loading = undefined
}
