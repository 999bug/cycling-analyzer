/**
 * 地图模式状态钩子（详情页 / 热力图 / 路线图共用的同一份偏好）。
 *
 * 初值取 localStorage 记忆（loadStoredMapMode），切换时同步写回。三处共用同一个存储键，
 * 因此任一处切换后，其余地图立即沿用；详情页的「导出视频 → 跟随当前底图」也读同一份记忆。
 */
import { useCallback, useState } from 'react'
import { loadStoredMapMode, storeMapMode, type MapMode } from '@/map/tileSources'

/** 地图模式状态：[当前模式, 切换回调] */
export type MapModeState = readonly [MapMode, (mode: MapMode) => void]

/**
 * 读取并持久化地图模式。
 *
 * @returns [当前模式, 切换回调]
 */
export function useMapMode(): MapModeState {
  const [mapMode, setMapMode] = useState<MapMode>(loadStoredMapMode)

  // 切换即写记忆：与地图高度同为跨会话保留的显示偏好
  const changeMapMode = useCallback((mode: MapMode) => {
    setMapMode(mode)
    storeMapMode(mode)
  }, [])

  return [mapMode, changeMapMode]
}
