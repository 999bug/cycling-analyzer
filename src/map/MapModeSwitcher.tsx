/**
 * 地图模式分段控件（悬浮于地图右下角，热力图 / 路线图共用）。
 *
 * 回放控制栏内嵌的模式按钮沿用 TrackReplay 自身的紧凑样式（横向排在控制条里），
 * 本组件提供地图角标形态：深色半透明胶囊 + 固定浅色字，压在矢量底图与卫星影像上都清晰。
 * 底图降级为 OSM 时三段整体禁用（OSM 无对应卫星源），与回放条同规则。
 */
import { MAP_MODES, type MapMode } from '@/map/tileSources'
import '@/map/mapModeSwitcher.css'

/** 地图模式切换控件参数 */
export interface MapModeSwitcherProps {
  /** 当前模式 */
  value: MapMode

  /** 切换回调 */
  onChange: (mode: MapMode) => void

  /** 是否可用（缺省可用；底图降级为 OSM 时传 false） */
  enabled?: boolean
}

/**
 * 地图模式分段控件。
 *
 * @param props 组件参数
 */
function MapModeSwitcher({ value, onChange, enabled = true }: MapModeSwitcherProps) {
  return (
    <span className="map-mode-switcher" role="group" aria-label="地图模式">
      {MAP_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={
            value === mode.id
              ? 'map-mode-switcher__mode map-mode-switcher__mode--active'
              : 'map-mode-switcher__mode'
          }
          aria-pressed={value === mode.id}
          disabled={!enabled}
          title={enabled ? `切换底图：${mode.label}` : '当前为降级底图，暂不支持切换地图模式'}
          onClick={() => onChange(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </span>
  )
}

export default MapModeSwitcher
