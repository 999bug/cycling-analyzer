/**
 * 地图模式切换控件 + useMapMode 钩子测试。
 *
 * - 三段按钮（正常 / 卫星 / 卫星+路网）按 MAP_MODES 渲染，当前值高亮 aria-pressed；
 * - 点击回传所选模式；
 * - enabled=false（底图降级为 OSM）时三段整体禁用并给出原因提示；
 * - useMapMode：初值恒为「正常」，切换只改状态、不写 localStorage（页面内生效）。
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MapModeSwitcher from '@/map/MapModeSwitcher'
import { useMapMode } from '@/map/useMapMode'
import { MAP_MODES } from '@/map/tileSources'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MapModeSwitcher', () => {
  it('按 MAP_MODES 渲染三段按钮，当前模式高亮', () => {
    render(<MapModeSwitcher value="satellite" onChange={vi.fn()} />)

    const group = screen.getByRole('group', { name: '地图模式' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(MAP_MODES.length)
    expect(screen.getByRole('button', { name: '卫星' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '正常' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '正常' }).className).not.toContain('--active')
    expect(screen.getByRole('button', { name: '卫星' }).className).toContain('--active')
  })

  it('点击回传所选模式', async () => {
    const onChange = vi.fn()
    render(<MapModeSwitcher value="normal" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '卫星+路网' }))

    expect(onChange).toHaveBeenCalledWith('satelliteRoads')
  })

  it('enabled=false 时三段禁用并提示原因', () => {
    render(<MapModeSwitcher value="normal" onChange={vi.fn()} enabled={false} />)

    for (const label of ['正常', '卫星', '卫星+路网']) {
      const button = screen.getByRole('button', { name: label })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', '当前为降级底图，暂不支持切换地图模式')
    }
  })
})

describe('useMapMode', () => {
  it('初值恒为「正常」（不读任何记忆）', () => {
    localStorage.setItem('cycling-map-mode', 'satellite')

    const { result } = renderHook(() => useMapMode())

    expect(result.current[0]).toBe('normal')
  })

  it('切换只改状态，不写 localStorage', () => {
    const { result } = renderHook(() => useMapMode())
    expect(result.current[0]).toBe('normal')

    act(() => {
      result.current[1]('satelliteRoads')
    })

    expect(result.current[0]).toBe('satelliteRoads')
    expect(localStorage.getItem('cycling-map-mode')).toBeNull()
  })
})
