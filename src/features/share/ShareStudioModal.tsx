/**
 * 社媒分享素材弹窗（Share Studio）。
 *
 * 出图链路：
 * - **真实界面**（DOM 快照）：弹窗里挂真实界面舞台（`ShareStageCard` / `ShareStageXhsPage`）——
 *   真实底图地图 + 真实指标卡 + 真实洞察区块 + 真实图表卡片，图上文字在侧栏直接改、预览即所得；
 *   下载时快照导出 2 倍图 PNG；快照不可用时自动降级到极简手绘，用户仍能拿到图。
 *   朋友圈 1 张；小红书 4 页（封面 / 路线 / 洞察 / 图表）。
 * - **极简手绘**（Canvas 本地绘制，`shareCanvas`）：无底图也就无网络请求，两平台通用。
 *
 * 文案分两层：**图上文字**（印进图片）与**发布文案**（复制到平台，不进图）。
 * Esc / 遮罩点击 / 关闭按钮退出。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, ActivityRecord } from '@/types/activity'
import type { DistanceUnit } from '@/features/settings/settings'
import { buildShareData, type ShareCaptions, type ShareData } from '@/features/share/shareData'
import {
  drawShareCard,
  downloadSharePng,
  sharePageCount,
  XHS_PAGE_LABELS,
  type SharePlatform,
} from '@/features/share/shareCanvas'
import ShareStageCard from '@/features/share/ShareStageCard'
import ShareStageXhsPage from '@/features/share/ShareStageXhsPage'
import { SHARE_STAGE_PAGES, type ShareStagePageId } from '@/features/share/shareStagePages'
import {
  captureShareStagePng,
  downloadShareStagePng,
  SHARE_STAGE_WIDTH,
  waitForStageTiles,
} from '@/features/share/shareStageCapture'
import { simplifyRoute } from '@/map/simplify'
import { formatDate } from '@/utils/format'
import '@/features/share/shareStudio.css'

/** 弹窗 props */
export interface ShareStudioModalProps {
  /** 活动摘要 */
  activity: Activity

  /** 清洗后的逐点数据（无轨迹可为空数组） */
  records: readonly ActivityRecord[]

  /** 距离显示单位（规格 §27） */
  distanceUnit: DistanceUnit

  /** FTP（W）：洞察强度分档（缺省不参与） */
  ftp?: number

  /** 最大心率（bpm）：洞察强度分档（缺省不参与） */
  maxHeartRate?: number

  /** 关闭回调 */
  onClose: () => void
}

/** 平台选项（v1 两平台；抖音复用竖屏视频导出，另行入口） */
const PLATFORMS: Array<{ id: SharePlatform; label: string; hint: string }> = [
  { id: 'moments', label: '朋友圈', hint: '单图：路线主视觉 + 核心指标' },
  { id: 'xhs', label: '小红书', hint: '4 页套图：封面 + 路线 + 洞察 + 图表' },
]

/** 卡片样式：真实界面（DOM 快照）/ 极简手绘（Canvas） */
type ShareStyle = 'stage' | 'canvas'

/** 样式选项（顺序即默认，首个为默认样式） */
const STYLES: Array<{ id: ShareStyle; label: string; hint: string }> = [
  { id: 'stage', label: '真实界面', hint: '真实地图 + 真实指标卡，图上可写字' },
  { id: 'canvas', label: '极简手绘', hint: '纯色卡片无底图，离线也能出图' },
]

/**
 * 轨迹抽稀容差（米）：与详情页 `SIMPLIFY_TOLERANCE_METERS` 同值——
 * 分享舞台展示与详情页地图出自同一条抽稀轨迹，观感一致。
 */
const ROUTE_SIMPLIFY_TOLERANCE_METERS = 5

/** 预览初始缩放（首帧 ResizeObserver 回报前的兜底，避免 1080px 舞台撑爆弹窗） */
const DEFAULT_STAGE_SCALE = 0.34

/** 导出流程状态：idle 正常 / busy 生成中 / fallback 已降级出图 / fail 未出图 */
type ExportState = 'idle' | 'busy' | 'fallback' | 'fail'

/** 舞台页标识：朋友圈单图 + 小红书四页（快照节点按它登记） */
type StagePageKey = ShareStagePageId | 'moments'

/** jsdom / 异常环境下 canvas 不可用时的降级标记（模块级探测一次，避免 effect 内 setState） */
const CANVAS_AVAILABLE =
  typeof document !== 'undefined' && document.createElement('canvas').getContext('2d') !== null

/**
 * 图上文案默认值：朋友圈文案首行（真实数据拼装，可编辑）。
 *
 * @param data 分享素材数据
 */
function defaultStageScript(data: ShareData): string {
  const firstLine = data.captions.moments.split('\n').find((line) => line.trim().length > 0)
  return firstLine ?? ''
}

/**
 * 社媒分享素材弹窗。
 *
 * @param props 组件参数
 */
function ShareStudioModal({
  activity,
  records,
  distanceUnit,
  ftp,
  maxHeartRate,
  onClose,
}: ShareStudioModalProps) {
  const [platform, setPlatform] = useState<SharePlatform>('moments')
  const [style, setStyle] = useState<ShareStyle>('stage')
  const [page, setPage] = useState(0)
  // 文案编辑态：与模板分离存储，「恢复默认」时重置回模板值
  const [captions, setCaptions] = useState<Record<string, string>>(() => ({}))
  // 图上文字编辑态（键缺省 = 用默认值）
  const [stageText, setStageText] = useState<{ title?: string; script?: string }>(() => ({}))
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [exportState, setExportState] = useState<ExportState>('idle')
  const [stageScale, setStageScale] = useState(DEFAULT_STAGE_SCALE)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  // 各页快照节点（页标识 → 节点）：小红书四页常驻挂载，出图按页取节点，不靠切换 state 抢时序
  const pageRefs = useRef(new Map<StagePageKey, HTMLDivElement>())

  const data = useMemo(
    () => buildShareData(activity, records, { distanceUnit, ftp, maxHeartRate }),
    [activity, records, distanceUnit, ftp, maxHeartRate],
  )
  // 与详情页同源的抽稀轨迹（真实界面舞台里的地图用）
  const routePoints = useMemo(
    () => simplifyRoute(records, ROUTE_SIMPLIFY_TOLERANCE_METERS),
    [records],
  )
  const pageCount = sharePageCount(platform)
  const dateKey = formatDate(activity.startTime)
  // 真实界面：朋友圈单图 / 小红书四页（极简手绘样式保持 v1 行为）
  const stageActive = style === 'stage'
  const stageXhs = stageActive && platform === 'xhs'
  const stageTitle = stageText.title ?? data.title
  const stageScript = stageText.script ?? defaultStageScript(data)
  // 真实界面下当前预览/下载的页（朋友圈恒 0）
  const stagePage: StagePageKey = stageXhs ? (SHARE_STAGE_PAGES[page]?.id ?? 'cover') : 'moments'
  const currentStageNode = () => (stageXhs ? pageRefs.current.get(stagePage) : pageRefs.current.get('moments'))

  // 当前平台的文案值：编辑过用编辑值，否则用模板默认
  const captionValue = (key: keyof ShareCaptions) => captions[key] ?? data.captions[key]

  // 预览绘制（数据/平台/页码变化即重绘；canvas 内部分辨率恒 1080×1440×2，CSS 缩放）
  useEffect(() => {
    if (canvasRef.current !== null) {
      drawShareCard(canvasRef.current, data, platform, page)
    }
  }, [data, platform, page])

  // 真实界面预览缩放：舞台恒 1080×1440（Leaflet 按布局尺寸取瓦片，不能靠 zoom 缩小布局），
  // 视觉上由插槽 transform 缩进弹窗，比例按画框实测宽度换算
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) {
        setStageScale(width / SHARE_STAGE_WIDTH)
      }
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [stageActive])

  // Esc 关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  /** 切平台时页码归零（朋友圈单页，小红书回到封面） */
  function handlePlatformChange(next: SharePlatform) {
    setPlatform(next)
    setPage(0)
    setExportState('idle')
  }

  /** 切卡片样式 */
  function handleStyleChange(next: ShareStyle) {
    setStyle(next)
    setExportState('idle')
  }

  /** 改图上文字（顺手清掉上一次的导出提示，避免提示与当前内容对不上） */
  function updateStageText(patch: { title?: string; script?: string }) {
    setStageText((current) => ({ ...current, ...patch }))
    setExportState('idle')
  }

  /** 真实界面出图不可用：降级为极简手绘（v1 链路），用户仍能拿到图 */
  function handleStageFallback(pageIndex = 0) {
    setExportState(downloadSharePng(data, platform, pageIndex, dateKey) ? 'fallback' : 'fail')
  }

  /** 单页出图并下载；失败（节点缺失/快照不可用）返回 false 交给调用方降级 */
  async function exportStagePage(node: HTMLElement | undefined, pageIndex: number): Promise<boolean> {
    if (node === undefined) {
      return false
    }
    // 先等真实底图瓦片落位（含地图的页才有瓦片；无瓦片的页立即返回）
    await waitForStageTiles(node)
    const blob = await captureShareStagePng(node)
    if (blob === undefined) {
      return false
    }
    downloadShareStagePng(blob, dateKey, pageCount > 1 ? SHARE_STAGE_PAGES[pageIndex]?.label : undefined)
    return true
  }

  /** 下载当前预览页 */
  async function handleDownload() {
    if (!stageActive) {
      downloadSharePng(data, platform, page, dateKey)
      return
    }
    setExportState('busy')
    const ok = await exportStagePage(currentStageNode(), stageXhs ? page : 0)
    if (!ok) {
      handleStageFallback(stageXhs ? page : 0)
      return
    }
    setExportState('idle')
  }

  /** 真实界面小红书：依次导出全部 4 页 */
  async function handleDownloadAll() {
    setExportState('busy')
    for (let index = 0; index < SHARE_STAGE_PAGES.length; index += 1) {
      const node = pageRefs.current.get(SHARE_STAGE_PAGES[index].id)
      const ok = await exportStagePage(node, index)
      if (!ok) {
        handleStageFallback(index)
        return
      }
    }
    setExportState('idle')
  }

  /** 极简手绘：依次下载全部页（小红书 4 张） */
  function handleCanvasDownloadAll() {
    for (let index = 0; index < pageCount; index += 1) {
      downloadSharePng(data, platform, index, dateKey)
    }
  }

  /** 复制当前平台文案（clipboard 不可用时 execCommand 兜底） */
  async function handleCopy() {
    const text =
      platform === 'moments'
        ? captionValue('moments')
        : `${captionValue('xhsTitle')}\n\n${captionValue('xhsBody')}`
    try {
      if (navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      }
      setCopyState('ok')
    } catch {
      setCopyState('fail')
    }
  }

  return (
    <div className="share-studio__overlay" onClick={onClose}>
      <div
        className="share-studio"
        role="dialog"
        aria-modal="true"
        aria-label="分享素材创作"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="share-studio__header">
          <div>
            <h2 className="share-studio__title">分享这次骑行</h2>
            <p className="share-studio__subtitle">{data.title} · {data.dateText}</p>
          </div>
          <button type="button" className="share-studio__close" aria-label="关闭" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M2 2 L14 14 M14 2 L2 14" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </button>
        </header>

        <div className="share-studio__body">
          <section className="share-studio__preview" aria-label="卡片预览">
            {stageActive ? (
              <>
                <div className="share-studio__stage-frame" ref={frameRef}>
                  <div
                    className="share-studio__stage-slot"
                    style={{ transform: `scale(${stageScale})` }}
                  >
                    {/* 页面常驻挂载（非当前页移出视口保留布局）：出图按节点取，不靠切 state 抢时序 */}
                    {platform === 'moments' ? (
                      <div
                        className="share-studio__stage-page"
                        ref={(node) => {
                          if (node === null) {
                            pageRefs.current.delete('moments')
                          } else {
                            pageRefs.current.set('moments', node)
                          }
                        }}
                      >
                        <ShareStageCard
                          activity={activity}
                          data={data}
                          routePoints={routePoints}
                          titleText={stageTitle}
                          scriptText={stageScript}
                        />
                      </div>
                    ) : (
                      SHARE_STAGE_PAGES.map((item, index) => (
                        <div
                          key={item.id}
                          className="share-studio__stage-page"
                          data-active={index === page}
                          aria-hidden={index !== page}
                          ref={(node) => {
                            if (node === null) {
                              pageRefs.current.delete(item.id)
                            } else {
                              pageRefs.current.set(item.id, node)
                            }
                          }}
                        >
                          <ShareStageXhsPage
                            page={item.id}
                            activity={activity}
                            data={data}
                            routePoints={routePoints}
                            records={records}
                            distanceUnit={distanceUnit}
                            ftp={ftp}
                            maxHeartRate={maxHeartRate}
                            scriptText={stageScript}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <p className="share-studio__preview-note">
                  {stageXhs
                    ? `第 ${page + 1}/${pageCount} 页 · 共 4 页套图，成图 1080×1440 的 2 倍图`
                    : '成图 1080×1440 的 2 倍图 · 底图为真实地图'}
                </p>
              </>
            ) : CANVAS_AVAILABLE ? (
              <div className="share-studio__canvas-frame">
                <canvas ref={canvasRef} className="share-studio__canvas" />
              </div>
            ) : (
              <p className="share-studio__fallback">当前环境不支持画布预览，下载功能不可用</p>
            )}
            {platform === 'xhs' && (
              <div className="share-studio__pager">
                <button
                  type="button"
                  className="share-studio__pager-btn"
                  onClick={() => setPage((current) => Math.max(current - 1, 0))}
                  disabled={page === 0}
                >
                  上一页
                </button>
                <span className="share-studio__pager-label">
                  {page + 1}/{pageCount} · {XHS_PAGE_LABELS[page]}
                </span>
                <button
                  type="button"
                  className="share-studio__pager-btn"
                  onClick={() => setPage((current) => Math.min(current + 1, pageCount - 1))}
                  disabled={page === pageCount - 1}
                >
                  下一页
                </button>
              </div>
            )}
          </section>

          <section className="share-studio__controls">
            <div className="share-studio__platforms">
              {PLATFORMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    item.id === platform
                      ? 'share-studio__platform share-studio__platform--active'
                      : 'share-studio__platform'
                  }
                  onClick={() => handlePlatformChange(item.id)}
                >
                  <span className="share-studio__platform-label">{item.label}</span>
                  <span className="share-studio__platform-hint">{item.hint}</span>
                </button>
              ))}
            </div>

            {/* 卡片样式：真实界面走 DOM 快照，极简手绘走 Canvas 绘制 */}
            <div className="share-studio__caption">
              <div className="share-studio__caption-head">
                <span className="share-studio__caption-title">卡片样式</span>
              </div>
              <div className="share-studio__platforms" role="group" aria-label="卡片样式">
                {STYLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      item.id === style
                        ? 'share-studio__platform share-studio__platform--active'
                        : 'share-studio__platform'
                    }
                    aria-pressed={item.id === style}
                    onClick={() => handleStyleChange(item.id)}
                  >
                    <span className="share-studio__platform-label">{item.label}</span>
                    <span className="share-studio__platform-hint">{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 图上文字：直接印在成片上，改完预览即所得 */}
            {stageActive && (
              <div className="share-studio__caption">
                <div className="share-studio__caption-head">
                  <span className="share-studio__caption-title">图上文字</span>
                  <span className="share-studio__caption-note">
                    {stageXhs ? '每条图上都有，印在图片上' : '印在图片上'}
                  </span>
                </div>
                {!stageXhs && (
                  <input
                    className="share-studio__caption-input"
                    value={stageTitle}
                    maxLength={24}
                    aria-label="图上标题"
                    onChange={(event) => updateStageText({ title: event.target.value })}
                  />
                )}
                <textarea
                  className="share-studio__caption-text"
                  value={stageScript}
                  aria-label="图上文案"
                  rows={3}
                  onChange={(event) => updateStageText({ script: event.target.value })}
                />
                <div className="share-studio__caption-actions">
                  <button
                    type="button"
                    className="share-studio__btn share-studio__btn--ghost"
                    onClick={() => {
                      setStageText({})
                      setExportState('idle')
                    }}
                  >
                    恢复默认文字
                  </button>
                </div>
              </div>
            )}

            <div className="share-studio__caption">
              <div className="share-studio__caption-head">
                <span className="share-studio__caption-title">发布文案</span>
                <span className="share-studio__caption-note">文案不进图，发布时粘贴使用</span>
              </div>
              {platform === 'xhs' && (
                <input
                  className="share-studio__caption-input"
                  value={captionValue('xhsTitle')}
                  maxLength={20}
                  aria-label="小红书标题"
                  onChange={(event) =>
                    setCaptions((current) => ({ ...current, xhsTitle: event.target.value }))
                  }
                />
              )}
              <textarea
                className="share-studio__caption-text"
                value={platform === 'moments' ? captionValue('moments') : captionValue('xhsBody')}
                aria-label={platform === 'moments' ? '朋友圈文案' : '小红书正文'}
                rows={platform === 'moments' ? 4 : 8}
                onChange={(event) =>
                  setCaptions((current) => ({
                    ...current,
                    [platform === 'moments' ? 'moments' : 'xhsBody']: event.target.value,
                  }))
                }
              />
              <div className="share-studio__caption-actions">
                <button
                  type="button"
                  className="share-studio__btn share-studio__btn--ghost"
                  onClick={() =>
                    setCaptions((current) => ({
                      ...current,
                      ...(platform === 'moments'
                        ? { moments: data.captions.moments }
                        : { xhsTitle: data.captions.xhsTitle, xhsBody: data.captions.xhsBody }),
                    }))
                  }
                >
                  恢复默认文案
                </button>
                <button
                  type="button"
                  className="share-studio__btn share-studio__btn--ghost"
                  onClick={() => void handleCopy()}
                >
                  {copyState === 'ok' ? '已复制' : copyState === 'fail' ? '复制失败' : '复制文案'}
                </button>
              </div>
            </div>
          </section>
        </div>

        <footer className="share-studio__footer">
          <span className="share-studio__privacy">
            {stageActive
              ? '图片在本机合成；底图瓦片来自地图服务，骑行数据不会上传'
              : '图片在本浏览器内绘制，不会上传到任何服务器'}
          </span>
          {exportState === 'fallback' && (
            <span className="share-studio__notice">真实界面出图不可用，已改用极简手绘导出</span>
          )}
          {exportState === 'fail' && (
            <span className="share-studio__notice">出图失败，请重试或改用极简手绘</span>
          )}
          <div className="share-studio__footer-actions">
            {platform === 'xhs' && (
              <button
                type="button"
                className="share-studio__btn share-studio__btn--ghost"
                disabled={exportState === 'busy'}
                onClick={() => (stageActive ? void handleDownloadAll() : handleCanvasDownloadAll())}
              >
                下载全部 {pageCount} 张
              </button>
            )}
            <button
              type="button"
              className="share-studio__btn share-studio__btn--primary"
              onClick={() => void handleDownload()}
              disabled={exportState === 'busy' || (!stageActive && !CANVAS_AVAILABLE)}
            >
              {exportState === 'busy' ? '生成中…' : '下载图片'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default ShareStudioModal
