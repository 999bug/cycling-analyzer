/**
 * 骑行区域统计测试（后续工作项：离线网格覆盖率）。
 *
 * 验证 0.01° 网格去重（同格重复骑只计一次）、跨格计数、
 * 面积随纬度收缩（高纬度网格面积更小）、空输入为 0。
 */
import { describe, expect, it } from 'vitest'
import { buildGridCoverage, GRID_CELL_DEGREES } from '@/features/heatmap/gridCoverage'

describe('buildGridCoverage', () => {
  it('同一网格内的多个点只计一次', () => {
    const coverage = buildGridCoverage([
      [
        [31.2001, 121.5001],
        [31.2002, 121.5002],
        [31.2003, 121.5003],
      ],
    ])
    expect(coverage.cellCount).toBe(1)
    expect(coverage.areaKm2).toBeGreaterThan(0)
  })

  it('跨网格的轨迹计多个网格，多条轨迹共享网格去重', () => {
    const track = [
      [31.2, 121.5],
      [31.21, 121.51],
    ] as const
    const coverage = buildGridCoverage([track, track])
    expect(coverage.cellCount).toBe(2)
  })

  it('南半球/负经度网格按 floor 正确归格', () => {
    // -33.861x 两点同属 floor(-3386.1x) = -3387 格
    const coverage = buildGridCoverage([
      [
        [-33.861, 151.201],
        [-33.8612, 151.2012],
      ],
    ])
    expect(coverage.cellCount).toBe(1)
  })

  it('高纬度网格面积小于赤道网格（经度收缩修正）', () => {
    const equator = buildGridCoverage([[[0.001, 0.001]]])
    const high = buildGridCoverage([[[60.001, 0.001]]])
    expect(equator.cellCount).toBe(1)
    expect(high.cellCount).toBe(1)
    expect(high.areaKm2).toBeLessThan(equator.areaKm2)
    // 赤道 0.01° 网格约 1.24 km²
    expect(equator.areaKm2).toBeCloseTo(1.2, 0)
  })

  it('空输入返回 0', () => {
    expect(buildGridCoverage([])).toEqual({ cellCount: 0, areaKm2: 0 })
  })

  it('网格边长为 0.01°（约 1km）', () => {
    expect(GRID_CELL_DEGREES).toBe(0.01)
  })
})
