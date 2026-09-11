/**
 * 地图模式状态钩子（详情页 / 热力图 / 路线图共用同一套控件与默认值）。
 *
 * **不持久化**（用户 2026-09-11 指定）：初值恒为「正常」，切换只改本页状态，
 * 刷新或换页即回到正常。此前三处共用 localStorage 记忆，结果是一次切卫星图、
 * 之后每个地图页面都是卫星图——而卫星影像上轨迹常看不清，属于「被记住的坏默认」。
 */
import { useState } from 'react'
import { DEFAULT_MAP_MODE, type MapMode } from '@/map/tileSources'

/** 地图模式状态：[当前模式, 切换回调] */
export type MapModeState = readonly [MapMode, (mode: MapMode) => void]

/**
 * 页面内的地图模式状态（默认「正常」，不写 localStorage）。
 *
 * @returns [当前模式, 切换回调]
 */
export function useMapMode(): MapModeState {
  const [mapMode, setMapMode] = useState<MapMode>(DEFAULT_MAP_MODE)
  return [mapMode, setMapMode]
}
