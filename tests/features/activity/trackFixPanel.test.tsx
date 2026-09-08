/**
 * 轨迹纠偏面板组件测试。
 *
 * - 默认选中已保存来源（sourceApp）对应的画像；
 * - 切换来源即时上报预览参数（坐标系映射正确）；
 * - 四向微调 ±10m 步进并随预览上报，「重置」归零；
 * - 保存时组合坐标系 / 来源 / 微调一次回调；来源「未知」上报 sourceApp=undefined。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TrackFixPanel from '@/features/activity/TrackFixPanel'

/** 空实现：onSave 需返回 Promise，async 函数对 void 返回类型的参数位同样可赋值 */
const noop = async () => {}

describe('轨迹纠偏面板', () => {
  it('默认选中已保存来源，且初始即上报当前坐标系预览', () => {
    const onPreviewChange = vi.fn()
    render(
      <TrackFixPanel
        sourceApp="xingzhe"
        coordinateSystem="gcj02"
        onPreviewChange={onPreviewChange}
        onSave={noop}
        onClose={noop}
      />,
    )

    const select = screen.getByLabelText(/数据来自哪个 App/) as HTMLSelectElement
    expect(select.value).toBe('xingzhe')
    // 挂载即上报一次当前状态（行者 → gcj02，无微调）
    expect(onPreviewChange).toHaveBeenCalledWith({
      coordinateSystem: 'gcj02',
      sourceApp: 'xingzhe',
      trackOffset: undefined,
    })
  })

  it('切换来源即时上报新坐标系（行者 → Strava 映射 gcj02 → wgs84）', () => {
    const onPreviewChange = vi.fn()
    render(
      <TrackFixPanel
        sourceApp="xingzhe"
        coordinateSystem="gcj02"
        onPreviewChange={onPreviewChange}
        onSave={noop}
        onClose={noop}
      />,
    )

    const select = screen.getByLabelText(/数据来自哪个 App/) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'strava' } })
    expect(onPreviewChange).toHaveBeenLastCalledWith({
      coordinateSystem: 'wgs84',
      sourceApp: 'strava',
      trackOffset: undefined,
    })
  })

  it('四向微调按 10m 步进并随预览上报，重置归零', () => {
    const onPreviewChange = vi.fn()
    render(
      <TrackFixPanel
        coordinateSystem="wgs84"
        onPreviewChange={onPreviewChange}
        onSave={noop}
        onClose={noop}
      />,
    )

    fireEvent.click(screen.getByTitle('向北 10m'))
    fireEvent.click(screen.getByTitle('向东 10m'))
    expect(onPreviewChange).toHaveBeenLastCalledWith({
      coordinateSystem: 'wgs84',
      sourceApp: undefined,
      trackOffset: { northMeters: 10, eastMeters: 10 },
    })

    fireEvent.click(screen.getByTitle('向南 10m'))
    fireEvent.click(screen.getByTitle('向西 10m'))
    // 微调回到 0,0 视为无微调，上报 undefined
    expect(onPreviewChange).toHaveBeenLastCalledWith({
      coordinateSystem: 'wgs84',
      sourceApp: undefined,
      trackOffset: undefined,
    })

    // 重置按钮：微调归零后禁用
    fireEvent.click(screen.getByTitle('向北 10m'))
    const reset = screen.getByRole('button', { name: '重置' })
    expect(reset).not.toBeDisabled()
    fireEvent.click(reset)
    expect(onPreviewChange).toHaveBeenLastCalledWith({
      coordinateSystem: 'wgs84',
      sourceApp: undefined,
      trackOffset: undefined,
    })
    expect(screen.getByRole('button', { name: '重置' })).toBeDisabled()
  })

  it('保存时组合坐标系 / 来源 / 微调一次回调', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <TrackFixPanel
        sourceApp="xingzhe"
        coordinateSystem="gcj02"
        onPreviewChange={noop}
        onSave={onSave}
        onClose={noop}
      />,
    )

    // 切到未知来源（sourceApp 上报 undefined，坐标系按 WGS-84 真值处理）
    const select = screen.getByLabelText(/数据来自哪个 App/) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'unknown' } })
    fireEvent.click(screen.getByTitle('向东 10m'))
    fireEvent.click(screen.getByRole('button', { name: '保存纠偏' }))

    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        coordinateSystem: 'wgs84',
        sourceApp: undefined,
        trackOffset: { northMeters: 0, eastMeters: 10 },
      })
    })
  })
})
