/**
 * 预缓存瓦片清单测试：URL 解析、清单命中判定与加载失败静默降级。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  localTileUrl,
  parseAmapTileUrl,
  resetManifestForTest,
} from '@/map/localTiles'

describe('parseAmapTileUrl', () => {
  it('解析高德模板实例化后的 z/x/y（子域已替换）', () => {
    const url =
      'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=210&y=107&z=8'
    expect(parseAmapTileUrl(url)).toEqual({ x: 210, y: 107, z: 8 })
  })

  it('非高德 URL 返回 null', () => {
    expect(
      parseAmapTileUrl('https://a.tile.openstreetmap.org/10/841/387.png'),
    ).toBeNull()
  })
})

describe('localTileUrl', () => {
  it('生成站点相对路径（BASE_URL 前缀）', () => {
    const url = localTileUrl(10, 841, 387)
    expect(url).toContain('/author-data/tiles/10/841/387.png')
    expect(url.startsWith(import.meta.env.BASE_URL)).toBe(true)
  })
})

describe('hasLocalTile 清单加载', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetManifestForTest()
  })

  it('清单命中返回 true，未命中返回 false', async () => {
    const { hasLocalTile } = await import('@/map/localTiles')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ['10/841/387', '12/840/400'],
      }),
    )

    await expect(hasLocalTile(10, 841, 387)).resolves.toBe(true)
    // 未命中
    await expect(hasLocalTile(15, 1, 1)).resolves.toBe(false)
  })

  it('清单加载失败静默降级：全部返回 false 不抛错', async () => {
    const { hasLocalTile } = await import('@/map/localTiles')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(hasLocalTile(10, 841, 387)).resolves.toBe(false)
    warn.mockRestore()
  })

  it('清单只加载一次（并发去重）', async () => {
    const { hasLocalTile } = await import('@/map/localTiles')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([hasLocalTile(8, 0, 0), hasLocalTile(9, 0, 0), hasLocalTile(10, 0, 0)])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
