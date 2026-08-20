/**
 * 离线偏好 hook：挂载时读取一次设置，
 * 未加载完成前返回默认值（瓦片缓存开启），页面刷新后生效。
 */
import { useEffect, useState } from 'react'
import { DEFAULT_OFFLINE, getSettings, type OfflinePreferences } from '@/features/settings/settings'

/**
 * 读取用户离线偏好（瓦片缓存开关）。
 *
 * @returns 离线偏好（设置未加载完成时为默认值）
 */
export function useOfflinePreferences(): OfflinePreferences {
  const [prefs, setPrefs] = useState<OfflinePreferences>(DEFAULT_OFFLINE)

  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((data) => {
        if (!cancelled) {
          setPrefs(data.offline)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load offline preferences', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return prefs
}