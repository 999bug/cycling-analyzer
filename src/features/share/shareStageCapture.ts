/**
 * 真实界面分享卡：DOM 快照导出层（分享素材 v2）。
 *
 * 与 `shareCanvas.ts`（极简手绘）并列的第二条出图链路——把「真实界面分享舞台」
 * （`ShareStageCard`：真实底图地图 + 真实指标卡 + 图上文案）整棵 DOM 交给 DOM 快照库
 * 出图，成片观感与站内页面一致（含当前主题、真实底图、真实轨迹）。
 *
 * 三条不可省的约束：
 * 1. **出图前必须等真实底图瓦片稳定**——瓦片是异步加载的，抢跑会得到一张空底图
 *    （轮询舞台内 `.leaflet-tile-loaded` 计数，连续多次不变才认为就绪，与导出视频同策略）；
 * 2. **出图必须清掉预览缩放**——预览靠舞台根节点的 CSS transform 缩进弹窗，
 *    快照时以 `style` 覆盖为 `none` 才能按原始 1080×1440 出图（见 captureShareStagePng）；
 * 3. **成片按 2 倍图导出**（2160×2880），社媒端不至于发虚。
 *
 * jsdom / 不支持 DOM 快照的环境一律返回 undefined，由调用方降级到极简手绘卡片。
 */

/** 舞台逻辑宽度（px） */
export const SHARE_STAGE_WIDTH = 1080

/** 舞台逻辑高度（px） */
export const SHARE_STAGE_HEIGHT = 1440

/** 出图倍率（社媒端清晰度与体积的折中） */
const EXPORT_SCALE = 2

/** 瓦片就绪轮询间隔（毫秒） */
const TILE_POLL_INTERVAL_MS = 200

/** 连续多少次计数不变视为瓦片稳定 */
const TILE_STABLE_HITS = 3

/** 等待瓦片就绪的最长时间（毫秒） */
const TILE_WAIT_MAX_MS = 8000

/** 一张瓦片都没出现（离线/瓦片源不可用）时的兜底等待（毫秒） */
const TILE_WAIT_FALLBACK_MS = 1200

/** 快照超时（毫秒）：超时即降级，不让弹窗卡在「生成中」 */
const CAPTURE_TIMEOUT_MS = 20000

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 下载文件名（含日期与样式标识，多次导出不覆盖）。
 *
 * @param dateKey 日期键（如 '2026-09-06'）
 */
export function shareStageFileName(dateKey: string): string {
  return `骑了么-${dateKey}-真实界面.png`
}

/**
 * 等舞台内的底图瓦片加载稳定。
 *
 * 不看「是否有瓦片」，而看「瓦片数是否不再变化」：长距离轨迹缩放级别大、瓦片多，
 * 固定 sleep 要么不够要么白等。一张都没加载出来时（离线、瓦片源不可用）
 * 只兜底等一小段就放行——底图缺失不阻断出图，轨迹与文字仍然有效。
 *
 * @param stage 分享舞台根节点
 * @param maxMs 最长等待（毫秒）
 */
export async function waitForStageTiles(stage: HTMLElement, maxMs = TILE_WAIT_MAX_MS): Promise<void> {
  const deadline = Date.now() + maxMs
  let previous = -1
  let stableHits = 0
  let sawTile = false
  while (Date.now() < deadline) {
    await sleep(TILE_POLL_INTERVAL_MS)
    const count = stage.querySelectorAll('.leaflet-tile-loaded').length
    if (count > 0) {
      sawTile = true
    }
    if (count === previous) {
      stableHits += 1
      if (stableHits >= TILE_STABLE_HITS) {
        return
      }
    } else {
      stableHits = 0
    }
    previous = count
  }
  if (!sawTile) {
    await sleep(TILE_WAIT_FALLBACK_MS)
  }
}

/**
 * 把分享舞台快照成 PNG（2 倍图）。
 *
 * 快照库按需动态引入：只有真正走「真实界面」链路的用户才会下载这份代码，
 * 极简手绘链路与首页首屏不受影响。
 *
 * @param stage 分享舞台根节点
 * @returns 成片 Blob；环境不支持 / 快照失败时 undefined（调用方降级）
 */
export async function captureShareStagePng(stage: HTMLElement): Promise<Blob | undefined> {
  try {
    const { domToBlob } = await import('modern-screenshot')
    const blob = await domToBlob(stage, {
      width: SHARE_STAGE_WIDTH,
      height: SHARE_STAGE_HEIGHT,
      scale: EXPORT_SCALE,
      timeout: CAPTURE_TIMEOUT_MS,
      // 预览时舞台带缩放 transform（缩进弹窗），出图必须还原为原始尺寸
      style: { transform: 'none', transformOrigin: 'top left' },
    })
    return blob.size > 0 ? blob : undefined
  } catch (error) {
    console.warn('Share stage capture failed', error)
    return undefined
  }
}

/**
 * 触发浏览器下载。
 *
 * @param blob 成片
 * @param dateKey 日期键（文件名用）
 */
export function downloadShareStagePng(blob: Blob, dateKey: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = shareStageFileName(dateKey)
  anchor.click()
  URL.revokeObjectURL(url)
}
