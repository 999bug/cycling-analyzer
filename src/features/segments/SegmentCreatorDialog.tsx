/**
 * 地图框选建段弹窗（赛段重设计二期）。
 *
 * 在活动轨迹地图上点击两点截取任意路段建段，替代「只能整趟首尾点建段」：
 * - 第一次点击 = 候选起点，第二次 = 终点；可一键交换方向（正/反向赛段）；
 * - 实时显示路段距离与推荐长度提示（Strava 经验值 0.4–1 km，过长 GPS
 *   匹配误差大，仅提示不拦截）；
 * - 两点齐后自动做历史命中预览：扫描近 90 天骑行活动，给出命中次数与
 *   正/反方向分布（正向 = 穿越方向与「起点 → 终点」一致）；匹配器只认
 *   单向穿越，故正反两个方向各匹配一次，往返 / 折返骑行都能统计到；
 * - 地图右上角支持全屏（桌面原生 Fullscreen API，移动端 / PWA 独立窗口
 *   自动降级伪全屏，见 mapFullscreen.tsx）：框选长路段时看得更清；
 * - 创建写入 segments 表（轨迹切片存 trackPoints 供路径校验），并把当前
 *   活动的穿越成绩增量回写 segment_efforts，跳转赛段页即可看到成绩。
 *
 * 坐标口径与匹配器一致：存储原始记录坐标（不做坐标系转换），展示投影。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleMarker, MapContainer, Polyline, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { FallbackTileLayer } from '@/map/FallbackTileLayer'
import { FullscreenSync, MapFullscreenButton } from '@/map/mapFullscreen'
import type { ActivityRecord, TrackOffset } from '@/types/activity'
import type { CoordinateSystem } from '@/geo/coordinateSystem'
import type { ActivityReadRepository } from '@/storage/repositories/activityRepository'
import { db } from '@/storage/db'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import {
  buildSegmentDraft,
  effortMatchesDirection,
  nearestProjectedIndex,
  reverseSegmentDraft,
  PICK_SNAP_REJECT_METERS,
  type SegmentDraft,
} from '@/features/segments/segmentCreator'
import { matchSegmentEffortDetail } from '@/features/segments/segmentMatching'
import { listCyclingSummaries } from '@/features/activity/cyclingScope'
import { projectPoint } from '@/geo/projection'
import { mapSystem } from '@/map/tileSources'
import './segmentCreator.css'

/** 推荐赛段长度区间（米，Strava 经验值：过长 GPS 匹配误差大） */
export const SEGMENT_LENGTH_RECOMMENDED_MIN = 400
export const SEGMENT_LENGTH_RECOMMENDED_MAX = 1000

/** 历史命中预览的时间窗口（毫秒：90 天） */
const PREVIEW_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

/** 命中预览结果 */
interface HitPreview {
  /** 命中次数 */
  total: number

  /** 正向命中次数（净位移与「起点 → 终点」一致） */
  forward: number
}

/** 默认仓库（弹窗注入点，测试传内存实现） */
const defaultRepository = new DexieSegmentRepository(db)

/**
 * 弹窗 props。
 */
export interface SegmentCreatorDialogProps {
  /** 是否打开 */
  open: boolean

  /** 关闭回调 */
  onClose: () => void

  /** 活动标题（建段默认名取它） */
  activityName: string

  /** 轨迹坐标系（展示投影用） */
  coordinateSystem?: CoordinateSystem

  /** 轨迹手动微调量（展示投影用） */
  trackOffset?: TrackOffset

  /** 活动完整逐点数据（未抽稀） */
  records: readonly ActivityRecord[]

  /** 活动开始时间（成绩回写 startTime 用） */
  startTime: string

  /** 来源活动 ID */
  sourceActivityId: string

  /** 活动仓库（命中预览用；注入便于测试） */
  activityRepository?: ActivityReadRepository

  /** 赛段仓库（注入便于测试） */
  segmentRepository?: typeof defaultRepository

  /** 瓦片源索引 */
  sourceIndex: number

  /** 瓦片降级回调 */
  onMapFallback?: () => void

  /** 创建成功回调（参数为新建赛段 id） */
  onCreated?: (segmentId: number) => void
}

/** 已选点（记录索引 + 投影展示坐标） */
interface Pick {
  /** 原始记录索引 */
  index: number

  /** 原始坐标纬度 */
  latitude: number

  /** 原始坐标经度 */
  longitude: number
}

/** 点击地图 → 吸附到最近轨迹点 */
function ClickCatcher({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

/** 地图挂载后适应整条轨迹 */
function FitTrack({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length >= 2) {
      map.fitBounds(points, { padding: [16, 16] })
    }
  }, [map, points])
  return null
}

/**
 * 地图框选建段弹窗。
 *
 * @param props 组件参数
 */
function SegmentCreatorDialog({
  open,
  onClose,
  activityName,
  coordinateSystem,
  trackOffset,
  records,
  startTime,
  sourceActivityId,
  activityRepository,
  segmentRepository = defaultRepository,
  sourceIndex,
  onMapFallback,
  onCreated,
}: SegmentCreatorDialogProps) {
  const navigate = useNavigate()

  // 地图包裹层（全屏目标：桌面走原生 Fullscreen API，移动端 / PWA 独立窗口伪全屏）
  const mapWrapperRef = useRef<HTMLDivElement>(null)

  // 第一次点击 = A（候选起点），第二次 = B；direction 反向时两圆互换
  const [pickA, setPickA] = useState<Pick | undefined>()
  const [pickB, setPickB] = useState<Pick | undefined>()
  const [reversed, setReversed] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | undefined>()

  // 命中预览状态（两点齐后计算）
  const [preview, setPreview] = useState<HitPreview | null | 'loading'>(null)

  // 投影展示轨迹 + 「投影索引 → 原始记录索引」映射：
  // 吸附必须在投影坐标系里做（点击返回的是底图坐标），映射回原始 records 索引建段
  const { projected, projectedRecordIndices } = useMemo<{
    projected: [number, number][]
    projectedRecordIndices: number[]
  }>(
    () => {
      const projected: [number, number][] = []
      const projectedRecordIndices: number[] = []
      records.forEach((record, index) => {
        if (record.latitude === undefined || record.longitude === undefined) {
          return
        }
        const point = projectPoint(
          { longitude: record.longitude, latitude: record.latitude },
          {
            from: coordinateSystem,
            to: mapSystem(sourceIndex),
            northMeters: trackOffset?.northMeters,
            eastMeters: trackOffset?.eastMeters,
          },
        )
        projected.push([point.latitude, point.longitude])
        projectedRecordIndices.push(index)
      })
      return { projected, projectedRecordIndices }
    },
    [records, coordinateSystem, trackOffset, sourceIndex],
  )

  // 打开时重置全部状态（异步 IIFE 内调用，避免 effect 同步 setState 连锁渲染）
  useEffect(() => {
    if (open) {
      void (async () => {
        setPickA(undefined)
        setPickB(undefined)
        setReversed(false)
        setName(activityName)
        setCreating(false)
        setError(undefined)
        setPreview(null)
      })()
    }
  }, [open, activityName])

  const draft = useMemo<SegmentDraft | undefined>(() => {
    if (pickA === undefined || pickB === undefined) {
      return undefined
    }
    return buildSegmentDraft(records, pickA.index, pickB.index)
  }, [pickA, pickB, records])

  // 展示用的起终点（反向时互换圆心），与 draft 的归一化方向解耦
  const displayStart = reversed ? pickB : pickA
  const displayEnd = reversed ? pickA : pickB

  // 两点齐后：近 90 天骑行命中预览（含方向分布）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 状态复位/进入计算中（异步 IIFE 内调用，避免 effect 同步 setState 连锁渲染）
      if (draft === undefined || activityRepository === undefined) {
        setPreview(null)
        return
      }
      setPreview('loading')
      try {
        const since = new Date(Date.now() - PREVIEW_WINDOW_MS).toISOString()
        const all = await listCyclingSummaries(activityRepository)
        const recent = all.filter((summary) => summary.startTime >= since)
        if (cancelled) {
          return
        }
        // 展示方向几何（起点 → 终点 = 展示起点 → 展示终点）与反向几何：
        // 匹配器只认「起点圆 → 终点圆」单向穿越，两个方向各匹配一次
        // 才统计得到往返 / 折返骑行（此前只算同向穿越，命中数偏少）
        const shownGeometry = reversed ? reverseSegmentDraft(draft) : draft
        const oppositeGeometry = reversed ? draft : reverseSegmentDraft(draft)
        let total = 0
        let forward = 0
        // 分批流式读取：近 90 天的活动可能有上百条，一次全量取回会占数百 MB；
        // 命中计数是纯累加，天然可按批处理（每批处理完原始逐点即可回收）
        await activityRepository.iterateRecordBatches(
          recent.map((summary) => summary.id),
          (batch) => {
            if (cancelled) {
              return false
            }
            for (const activityRecords of batch.values()) {
              const shownMatch = matchSegmentEffortDetail(shownGeometry, activityRecords)
              const oppositeMatch = matchSegmentEffortDetail(oppositeGeometry, activityRecords)
              // 同向穿越默认记正向、反向穿越默认记反向；净位移能判定时以判定为准
              if (shownMatch !== undefined) {
                total += 1
                if (
                  effortMatchesDirection(
                    shownGeometry,
                    activityRecords,
                    shownMatch.startTimestamp,
                    shownMatch.endTimestamp,
                  ) !== false
                ) {
                  forward += 1
                }
              }
              if (oppositeMatch !== undefined) {
                total += 1
                if (
                  effortMatchesDirection(
                    shownGeometry,
                    activityRecords,
                    oppositeMatch.startTimestamp,
                    oppositeMatch.endTimestamp,
                  ) === true
                ) {
                  forward += 1
                }
              }
            }
          },
        )
        if (!cancelled) {
          setPreview({ total, forward })
        }
      } catch (err: unknown) {
        console.error('Failed to preview segment hits', err)
        if (!cancelled) {
          setPreview(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [draft, reversed, activityRepository])

  if (!open) {
    return null
  }

  const handleMapPick = (latitude: number, longitude: number) => {
    // 吸附在投影坐标系里算（与点击同坐标系，修复 GCJ-02 偏差导致的跑偏），
    // 超出拒绝半径不吸附；再经映射表还原到原始 records 索引
    const projectedIndex = nearestProjectedIndex(
      projected,
      latitude,
      longitude,
      PICK_SNAP_REJECT_METERS,
    )
    if (projectedIndex === undefined) {
      return
    }
    const index = projectedRecordIndices[projectedIndex]
    if (index === undefined) {
      return
    }
    const record = records[index]
    if (record?.latitude === undefined || record?.longitude === undefined) {
      return
    }
    const pick: Pick = { index, latitude: record.latitude, longitude: record.longitude }
    if (pickA === undefined) {
      setPickA(pick)
      return
    }
    // 已有两点后再点：重新开始新一轮选取
    if (pickB !== undefined) {
      setPickA(pick)
      setPickB(undefined)
      return
    }
    // 与 A 相同点：忽略
    if (pick.index === pickA.index) {
      return
    }
    setPickB(pick)
  }

  const handleCreate = () => {
    if (draft === undefined || creating) {
      return
    }
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('请先给赛段起个名字。')
      return
    }
    setCreating(true)
    setError(undefined)
    // 展示方向（反向）等价于交换起终点圆
    const geometry = reversed
      ? {
          startLatitude: draft.endLatitude,
          startLongitude: draft.endLongitude,
          endLatitude: draft.startLatitude,
          endLongitude: draft.endLongitude,
        }
      : {
          startLatitude: draft.startLatitude,
          startLongitude: draft.startLongitude,
          endLatitude: draft.endLatitude,
          endLongitude: draft.endLongitude,
        }
    segmentRepository
      .addSegment({
        name: trimmed,
        ...geometry,
        sourceActivityId,
        createdAt: new Date().toISOString(),
        trackPoints: draft.trackPoints,
      })
      .then((segmentId) => {
        // 当前活动按存储几何重新匹配，窗口内成绩立即回写（实时给 PR 基线）
        const match = matchSegmentEffortDetail(
          { ...geometry, trackPoints: draft.trackPoints },
          records,
        )
        if (match !== undefined) {
          return segmentRepository
            .upsertActivityEffort(segmentId, sourceActivityId, {
              startTime,
              durationSeconds: match.durationSeconds,
            })
            .then(() => segmentId)
        }
        return segmentId
      })
      .then((segmentId) => {
        onCreated?.(segmentId)
        onClose()
        navigate('/segments')
      })
      .catch((err: unknown) => {
        console.error('Failed to create segment', err)
        setCreating(false)
        setError('创建失败，请重试。')
      })
  }

  const distanceText =
    draft === undefined
      ? '—'
      : draft.distanceMeters >= SEGMENT_LENGTH_RECOMMENDED_MIN &&
          draft.distanceMeters <= SEGMENT_LENGTH_RECOMMENDED_MAX
        ? `${(draft.distanceMeters / 1000).toFixed(2)} km`
        : `${(draft.distanceMeters / 1000).toFixed(2)} km（超出 0.4–1 km 推荐区间）`

  const distanceClass =
    draft === undefined
      ? ''
      : draft.distanceMeters >= SEGMENT_LENGTH_RECOMMENDED_MIN &&
          draft.distanceMeters <= SEGMENT_LENGTH_RECOMMENDED_MAX
        ? 'segment-creator__check-ok'
        : 'segment-creator__check-warn'

  // 投影展示坐标（吸附点显示在轨迹上）
  const project = (pick: Pick | undefined): [number, number] | undefined => {
    if (pick === undefined) {
      return undefined
    }
    const point = projectPoint(
      { longitude: pick.longitude, latitude: pick.latitude },
      {
        from: coordinateSystem,
        to: mapSystem(sourceIndex),
        northMeters: trackOffset?.northMeters,
        eastMeters: trackOffset?.eastMeters,
      },
    )
    return [point.latitude, point.longitude]
  }
  const startMarker = project(displayStart)
  const endMarker = project(displayEnd)
  const center = projected[Math.floor(projected.length / 2)] as [number, number] | undefined

  return (
    <div className="segment-creator__overlay" role="dialog" aria-label="截取路段建段">
      <div className="segment-creator">
        <div className="segment-creator__head">
          <div>
            <h2 className="segment-creator__title">截取路段建段</h2>
            <p className="segment-creator__subtitle">在轨迹上点击两点：第一点为起点，第二点为终点</p>
          </div>
          <button
            type="button"
            className="segment-creator__close"
            aria-label="关闭建段弹窗"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="segment-creator__body">
          <div className="segment-creator__map map-fullscreen-wrapper" ref={mapWrapperRef}>
            {center !== undefined && (
              <MapContainer
                center={center}
                zoom={14}
                scrollWheelZoom
                className="segment-creator__leaflet"
              >
                <FallbackTileLayer sourceIndex={sourceIndex} onFallback={onMapFallback ?? (() => {})} />
                <Polyline
                  positions={projected}
                  pathOptions={{ color: '#fc4c02', weight: 3, opacity: 0.8 }}
                />
                {startMarker !== undefined && (
                  <CircleMarker
                    center={startMarker}
                    radius={7}
                    pathOptions={{ color: '#b8e62e', fillColor: '#b8e62e', fillOpacity: 1 }}
                  />
                )}
                {endMarker !== undefined && (
                  <CircleMarker
                    center={endMarker}
                    radius={7}
                    pathOptions={{ color: '#ff9f0a', fillColor: '#ff9f0a', fillOpacity: 1 }}
                  />
                )}
                <ClickCatcher onPick={handleMapPick} />
                <FitTrack points={projected} />
                {/* 进出全屏后重算地图尺寸，避免瓦片错位 */}
                <FullscreenSync />
              </MapContainer>
            )}
            {center !== undefined && <MapFullscreenButton targetRef={mapWrapperRef} />}
            <div className="segment-creator__map-hint">
              {pickA === undefined
                ? '等待选择起点'
                : pickB === undefined
                  ? '已选起点，再点一点作为终点'
                  : '已选起终点，可在右侧确认创建'}
            </div>
          </div>

          <div className="segment-creator__panel">
            <label className="segment-creator__field">
              <span>赛段名称</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="给赛段起个名字"
              />
            </label>

            <div className="segment-creator__field">
              <span>方向</span>
              <div className="segment-creator__dir" role="group" aria-label="赛段方向">
                <button
                  type="button"
                  className={reversed ? '' : 'segment-creator__dir-on'}
                  onClick={() => setReversed(false)}
                >
                  正向
                </button>
                <button
                  type="button"
                  className={reversed ? 'segment-creator__dir-on' : ''}
                  onClick={() => setReversed(true)}
                >
                  反向
                </button>
              </div>
            </div>

            <div className="segment-creator__checks">
              <div className="segment-creator__check">
                <span>距离</span>
                <span className={`segment-creator__num ${distanceClass}`}>{distanceText}</span>
              </div>
              <div className="segment-creator__check">
                <span>方向一致性（近 90 天）</span>
                <span className="segment-creator__num">
                  {draft === undefined
                    ? '—'
                    : preview === 'loading'
                      ? '计算中…'
                      : preview === null
                        ? '—'
                        : preview.total === 0
                          ? '近 90 天无命中'
                          : `${preview.total} 次命中 · 正向 ${preview.forward} / 反向 ${preview.total - preview.forward}`}
                </span>
              </div>
            </div>

            {error !== undefined && <p className="segment-creator__error">{error}</p>}

            <div className="segment-creator__actions">
              <button
                type="button"
                className="segment-creator__ghost"
                onClick={() => {
                  setPickA(undefined)
                  setPickB(undefined)
                }}
                disabled={pickA === undefined}
              >
                重新框选
              </button>
              <button
                type="button"
                className="segment-creator__primary"
                onClick={handleCreate}
                disabled={draft === undefined || creating}
              >
                {creating ? '创建中…' : '创建赛段'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SegmentCreatorDialog
