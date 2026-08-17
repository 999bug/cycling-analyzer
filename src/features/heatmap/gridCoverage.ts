/**
 * 骑行区域统计（后续工作项：离线网格覆盖率）。
 *
 * 将地球表面划分为 0.01°（约 1km）网格，统计轨迹覆盖的唯一网格数，
 * 并按网格中心纬度修正经度收缩估算覆盖面积。纯离线计算，无外部依赖。
 */

/** 网格边长（度）：0.01° ≈ 纬度方向 1.11km */
export const GRID_CELL_DEGREES = 0.01

/** 纬度 1° 对应的公里数（WGS84 近似） */
const KILOMETERS_PER_DEGREE = 111.32

/** 面积展示小数位 */
const AREA_DECIMALS_FACTOR = 10

/** 经纬度元组（Leaflet 坐标顺序） */
type LatLng = readonly [number, number]

/**
 * 网格覆盖统计结果。
 */
export interface GridCoverage {
  /** 覆盖的唯一网格数 */
  cellCount: number

  /** 估算覆盖面积（km²，按纬度修正经度收缩） */
  areaKm2: number
}

/**
 * 统计轨迹覆盖的网格（同一网格多次骑过只计一次）。
 *
 * @param tracks 轨迹列表（每条为经纬度元组数组）
 * @returns 覆盖统计；无轨迹返回 0
 */
export function buildGridCoverage(tracks: readonly (readonly LatLng[])[]): GridCoverage {
  // key = 纬度格索引:经度格索引；value = 网格中心纬度（算面积用）
  const cells = new Map<string, number>()

  for (const track of tracks) {
    for (const [lat, lng] of track) {
      const latIndex = Math.floor(lat / GRID_CELL_DEGREES)
      const lngIndex = Math.floor(lng / GRID_CELL_DEGREES)
      const key = `${latIndex}:${lngIndex}`
      if (!cells.has(key)) {
        cells.set(key, (latIndex + 0.5) * GRID_CELL_DEGREES)
      }
    }
  }

  let areaKm2 = 0
  const heightKm = KILOMETERS_PER_DEGREE * GRID_CELL_DEGREES
  for (const centerLat of cells.values()) {
    const widthKm = heightKm * Math.cos((centerLat * Math.PI) / 180)
    areaKm2 += heightKm * widthKm
  }

  return {
    cellCount: cells.size,
    areaKm2: Math.round(areaKm2 * AREA_DECIMALS_FACTOR) / AREA_DECIMALS_FACTOR,
  }
}
