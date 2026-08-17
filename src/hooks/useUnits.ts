/**
 * 单位偏好 hook（规格 §27）：挂载时读取一次设置，
 * 未加载完成前返回默认公制（DEFAULT_UNITS），页面刷新后生效。
 */
import { useEffect, useState } from 'react'
import {
  DEFAULT_UNITS,
  getSettings,
  type UnitPreferences,
} from '@/features/settings/settings'

/**
 * 读取用户单位偏好（距离 km/mi、时间 12h/24h）。
 *
 * @returns 单位偏好（设置未加载完成时为默认公制）
 */
export function useUnits(): UnitPreferences {
  const [units, setUnits] = useState<UnitPreferences>(DEFAULT_UNITS)

  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((data) => {
        if (!cancelled) {
          setUnits(data.units)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load unit preferences', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return units
}
