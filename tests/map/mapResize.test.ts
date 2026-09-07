/**
 * 地图高度拖拽纯逻辑测试：钳制边界 + localStorage 持久化容错。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAP_HEIGHT_MIN,
  clampMapHeight,
  loadSavedMapHeight,
  saveMapHeight,
} from '@/map/mapResize'

describe('clampMapHeight（高度钳制）', () => {
  it('低于最小值时钳制到 MAP_HEIGHT_MIN', () => {
    expect(clampMapHeight(100, 1000)).toBe(MAP_HEIGHT_MIN)
  })

  it('超过视口预留上限时钳制到 视口 - 160', () => {
    expect(clampMapHeight(2000, 1080)).toBe(1080 - 160)
  })

  it('视口极小时上限不低于最小值（保证地图可用）', () => {
    expect(clampMapHeight(500, 300)).toBe(MAP_HEIGHT_MIN)
  })

  it('合法值原样返回', () => {
    expect(clampMapHeight(520, 1080)).toBe(520)
  })

  it('非法输入（NaN/Infinity）退化为最小值', () => {
    expect(clampMapHeight(Number.NaN, 1080)).toBe(MAP_HEIGHT_MIN)
    expect(clampMapHeight(Number.POSITIVE_INFINITY, 1080)).toBe(1080 - 160)
  })
})

describe('地图高度持久化', () => {
  afterEach(() => {
    localStorage.removeItem('cycling-analyzer:map-height')
  })

  it('未存储时返回 null（走 CSS 默认高度）', () => {
    expect(loadSavedMapHeight()).toBeNull()
  })

  it('save → load 往返一致', () => {
    saveMapHeight(560.4)
    expect(loadSavedMapHeight()).toBe(560)
  })

  it('存储值低于最小值时视为无效返回 null', () => {
    localStorage.setItem('cycling-analyzer:map-height', '100')
    expect(loadSavedMapHeight()).toBeNull()
  })

  it('存储非数字时返回 null', () => {
    localStorage.setItem('cycling-analyzer:map-height', 'abc')
    expect(loadSavedMapHeight()).toBeNull()
  })
})
