/**
 * 降级瓦片层测试。
 *
 * - 连续失败达阈值触发降级回调（tileload 重置计数，网络抖动不误判）；
 * - 降级单向防重：触发一次后不再重复回调；
 * - 渲染当前瓦片源配置（url / 版权署名）；
 * - 卸载时移除事件监听。
 *
 * mock react-leaflet：useMap 返回假 map（手动触发事件），TileLayer 渲染为可断言 div。
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FallbackTileLayer } from '@/map/FallbackTileLayer'
import { FALLBACK_TILE_ERROR_THRESHOLD, TILE_SOURCES } from '@/map/tileSources'

/** 假 Leaflet map：记录监听器，支持手动触发事件（vi.mock 提升所需，用 vi.hoisted） */
const { fakeMap } = vi.hoisted(() => {
  const handlers = new Map<string, () => void>()
  return {
    fakeMap: {
      on: vi.fn((type: string, fn: () => void) => {
        handlers.set(type, fn)
      }),
      off: vi.fn((type: string) => {
        handlers.delete(type)
      }),
      fire: (type: string) => {
        handlers.get(type)?.()
      },
    },
  }
})

// 只替换 useMap（假 map）与 TileLayer（可断言 div），其余透传真实 react-leaflet
vi.mock('react-leaflet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-leaflet')>()
  return {
    ...actual,
    useMap: () => fakeMap,
    TileLayer: ({ url, attribution }: { url: string; attribution: string }) => (
      <div data-testid="tile-layer" data-url={url} data-attribution={attribution} />
    ),
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('降级瓦片层', () => {
  it('连续失败达阈值触发降级回调一次', () => {
    const onFallback = vi.fn()
    render(<FallbackTileLayer sourceIndex={0} onFallback={onFallback} />)

    for (let i = 0; i < FALLBACK_TILE_ERROR_THRESHOLD; i++) {
      fakeMap.fire('tileerror')
    }

    expect(onFallback).toHaveBeenCalledTimes(1)
  })

  it('失败未达阈值不触发降级', () => {
    const onFallback = vi.fn()
    render(<FallbackTileLayer sourceIndex={0} onFallback={onFallback} />)

    fakeMap.fire('tileerror')
    fakeMap.fire('tileerror')

    expect(onFallback).not.toHaveBeenCalled()
  })

  it('成功加载重置失败计数（网络抖动不误判）', () => {
    const onFallback = vi.fn()
    render(<FallbackTileLayer sourceIndex={0} onFallback={onFallback} />)

    // 一次成功夹在两次失败之间：重置计数，随后再失败两次仍不达阈值
    fakeMap.fire('tileerror')
    fakeMap.fire('tileload')
    fakeMap.fire('tileerror')
    fakeMap.fire('tileerror')
    expect(onFallback).not.toHaveBeenCalled()

    // 再加一次失败才达连续 3 次
    fakeMap.fire('tileerror')
    expect(onFallback).toHaveBeenCalledTimes(1)
  })

  it('降级单向防重：触发后继续失败不重复回调', () => {
    const onFallback = vi.fn()
    render(<FallbackTileLayer sourceIndex={0} onFallback={onFallback} />)

    for (let i = 0; i < FALLBACK_TILE_ERROR_THRESHOLD + 3; i++) {
      fakeMap.fire('tileerror')
    }

    expect(onFallback).toHaveBeenCalledTimes(1)
  })

  it('渲染当前瓦片源配置（高德源带版权署名）', () => {
    render(<FallbackTileLayer sourceIndex={1} onFallback={vi.fn()} />)

    const layer = screen.getByTestId('tile-layer')
    expect(layer).toHaveAttribute('data-url', TILE_SOURCES[1].url)
    expect(layer.getAttribute('data-attribution')).toContain('高德')
  })

  it('卸载时移除事件监听', () => {
    const { unmount } = render(<FallbackTileLayer sourceIndex={0} onFallback={vi.fn()} />)

    unmount()

    // on 注册了 tileerror 与 tileload，off 应成对移除（事件名 + 处理函数）
    expect(fakeMap.off).toHaveBeenCalledWith('tileerror', expect.any(Function))
    expect(fakeMap.off).toHaveBeenCalledWith('tileload', expect.any(Function))
  })
})
