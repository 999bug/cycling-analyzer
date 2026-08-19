/**
 * 活动对比区块：从活动列表选择另一个活动，双轨迹叠加地图 + 六项指标对比表。
 * 双数据源通用（作者源/本地源均经 useActivityRepository 取数）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { compareActivities } from '@/features/activity/compare'
import { FallbackTileLayer } from '@/map/FallbackTileLayer'
import { TILE_FALLBACK_STORAGE_KEY } from '@/map/tileSources'
import { simplifyRoute } from '@/map/simplify'
import {
  FullscreenSync,
  MapFullscreenButton,
  ZoomControlBottomRight,
} from '@/map/mapFullscreen'
import { formatDistanceByUnit, formatSpeedByUnit, type DistanceUnit } from '@/features/settings/settings'
import { formatDuration } from '@/utils/format'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import type { Activity, ActivityRecord } from '@/types/activity'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import '@/features/activity/CompareSection.css'

/** 当前活动轨迹颜色（蓝）与对比活动轨迹颜色（橙） */
const TRACK_A_COLOR = '#4f8cff'
const TRACK_B_COLOR = '#f97316'

/** 一条可绘制轨迹至少需要 2 个点 */
const MIN_TRACK_POINTS = 2

/** 轨迹抽稀阈值（米） */
const COMPARE_SIMPLIFY_METERS = 10

/** 对比活动下拉选项数量上限（避免超长列表） */
const MAX_OPTIONS = 100

/**
 * 自动适配视野子组件。
 *
 * @param tracks 全部轨迹点
 */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length >= MIN_TRACK_POINTS) {
      map.fitBounds(points, { padding: [24, 24] })
    }
  }, [map, points])
  return null
}

/**
 * 活动对比区块 props。
 */
export interface CompareSectionProps {
  /** 当前活动（摘要字段用于指标对比） */
  activity: Activity

  /** 当前活动逐点记录（轨迹展示） */
  records: ActivityRecord[]

  /** 距离显示单位（规格 §27） */
  distanceUnit: DistanceUnit
}

/**
 * 活动对比区块组件。
 *
 * @param props 组件参数
 */
function CompareSection({ activity, records, distanceUnit }: CompareSectionProps) {
  // 可对比活动列表（null = 加载中）
  const [summaries, setSummaries] = useState<ActivitySummary[] | null>(null)
  // 选中对比活动（null = 未选择）
  const [selected, setSelected] = useState<ActivitySummary | null>(null)
  // 对比活动轨迹（含所属活动 ID：渲染层按 ID 匹配，切换选择时旧轨迹不串显）
  const [otherData, setOtherData] = useState<{
    id: string
    points: [number, number][]
  } | null>(null)
  // 当前瓦片源索引（瓦片降级）
  const [sourceIndex, setSourceIndex] = useState(
    () => (sessionStorage.getItem(TILE_FALLBACK_STORAGE_KEY) === 'amap' ? 1 : 0),
  )
  const wrapperRef = useRef<HTMLDivElement>(null)
  const repository = useActivityRepository()

  // 加载可对比活动列表（排除自身，最近优先）
  useEffect(() => {
    let cancelled = false
    repository
      .listAllSummaries()
      .then((all) => {
        if (!cancelled) {
          setSummaries(all.filter((item) => item.id !== activity.id).slice(0, MAX_OPTIONS))
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load compare options', error)
        if (!cancelled) {
          setSummaries([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [repository, activity.id])

  // 选中活动后加载其轨迹（异步回调中 setState；渲染层按 ID 匹配防串显）
  useEffect(() => {
    if (selected === null) {
      return
    }
    let cancelled = false
    repository
      .getRecords(selected.id)
      .then((otherRecords) => {
        const points = simplifyRoute(otherRecords, COMPARE_SIMPLIFY_METERS).map(
          (point) => [point.latitude, point.longitude] as [number, number],
        )
        if (!cancelled) {
          setOtherData({ id: selected.id, points })
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load comparison records', error)
        if (!cancelled) {
          setOtherData({ id: selected.id, points: [] })
        }
      })
    return () => {
      cancelled = true
    }
  }, [selected, repository])

  // 当前活动轨迹点
  const currentPoints = useMemo(
    () =>
      simplifyRoute(records, COMPARE_SIMPLIFY_METERS).map(
        (point) => [point.latitude, point.longitude] as [number, number],
      ),
    [records],
  )

  // 指标对比行
  const rows = useMemo(
    () => (selected !== null ? compareActivities(activity, selected) : []),
    [activity, selected],
  )

  // 对比活动轨迹（按选中 ID 匹配；未选择或加载中为 null）
  const otherPoints = otherData !== null && otherData.id === selected?.id ? otherData.points : null

  // 全部轨迹点（视野适配）
  const allPoints = useMemo(
    () => [...currentPoints, ...(otherPoints ?? [])],
    [currentPoints, otherPoints],
  )

  return (
    <section className="compare-section" aria-label="活动对比">
      <h2 className="compare-section__title">活动对比</h2>
      <div className="compare-section__picker">
        <label className="compare-section__label" htmlFor="compare-select">
          选择对比活动
        </label>
        <select
          id="compare-select"
          className="compare-section__select"
          value={selected?.id ?? ''}
          onChange={(event) => {
            const next = summaries?.find((item) => item.id === event.target.value) ?? null
            setSelected(next)
          }}
        >
          <option value="">未选择</option>
          {summaries?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name ?? item.id.slice(0, 8)} · {formatDateShort(item.startTime)}
            </option>
          ))}
        </select>
      </div>

      {selected !== null && (
        <>
          <div className="compare-section__map-wrapper map-fullscreen-wrapper" ref={wrapperRef}>
            <MapContainer
              className="compare-section__map"
              center={allPoints[0] ?? [31.2, 121.5]}
              zoom={12}
              scrollWheelZoom
            >
              <FallbackTileLayer sourceIndex={sourceIndex} onFallback={() => {
                setSourceIndex(1)
                sessionStorage.setItem(TILE_FALLBACK_STORAGE_KEY, 'amap')
              }} />
              {currentPoints.length >= MIN_TRACK_POINTS && (
                <Polyline
                  positions={currentPoints}
                  pathOptions={{ color: TRACK_A_COLOR, weight: 4, opacity: 0.95 }}
                />
              )}
              {otherPoints !== null && otherPoints.length >= MIN_TRACK_POINTS && (
                <Polyline
                  positions={otherPoints}
                  pathOptions={{ color: TRACK_B_COLOR, weight: 4, opacity: 0.95 }}
                />
              )}
              <FitBounds points={allPoints} />
              <FullscreenSync />
              <ZoomControlBottomRight />
            </MapContainer>
            <MapFullscreenButton targetRef={wrapperRef} />
          </div>

          <div className="compare-section__legend">
            <span className="compare-section__legend-item">
              <span className="compare-section__legend-dot compare-section__legend-dot--a" />
              {activity.name ?? '当前活动'}
            </span>
            <span className="compare-section__legend-item">
              <span className="compare-section__legend-dot compare-section__legend-dot--b" />
              {selected.name ?? '对比活动'}
            </span>
          </div>

          <div className="compare-section__scroller">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>{activity.name ?? '当前活动'}</th>
                  <th>{selected.name ?? '对比活动'}</th>
                  <th>差值</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{formatCompareValue(row.label, row.a, distanceUnit)}</td>
                    <td>{formatCompareValue(row.label, row.b, distanceUnit)}</td>
                    <td className={diffClass(row.diff)}>{formatCompareValue(row.label, row.diff, distanceUnit, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/** 对比值格式化（按指标单位；差值带正负号） */
function formatCompareValue(
  label: string,
  value: number | null | undefined,
  distanceUnit: DistanceUnit,
  signed = false,
): string {
  if (typeof value !== 'number') {
    return '—'
  }
  const prefix = signed && value > 0 ? '+' : ''
  switch (label) {
    case '距离':
      return `${prefix}${formatDistanceByUnit(value, distanceUnit)}`
    case '运动时长':
      return `${prefix}${formatDuration(value)}`
    case '爬升':
      return `${prefix}${Math.round(value)} m`
    case '平均速度':
      return `${prefix}${formatSpeedByUnit(value, distanceUnit)}`
    default:
      return `${prefix}${Math.round(value)}`
  }
}

/** 差值列样式：正 = 增长（红/橙），负 = 减少（绿） */
function diffClass(diff: number | null | undefined): string | undefined {
  if (typeof diff !== 'number' || diff === 0) {
    return undefined
  }
  return diff > 0 ? 'compare-table__diff--up' : 'compare-table__diff--down'
}

/** 日期短格式（MM-DD） */
function formatDateShort(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default CompareSection
