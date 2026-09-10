/**
 * 回放视频导出选项的数据模型与本地记忆。
 *
 * 与面板组件分文件：面板只导出 React 组件（react-refresh 要求），
 * 类型/默认值/选项列表/记忆读写都放这里，便于单测与复用。
 */
import {
  DEFAULT_VIDEO_ASPECT_RATIO,
  type VideoAspectRatio,
  type VideoDurationChoice,
  type VideoMapModeChoice,
} from '@/features/activity/trackVideoExport'

/**
 * 面板选项（value 与领域类型一一对应，label 为按钮文案）。
 */
export interface VideoExportSettings {
  /** 画布比例 */
  aspectRatio: VideoAspectRatio

  /** 时长档位（或「跟随里程」） */
  duration: VideoDurationChoice

  /** 底图（跟随当前 / 正常 / 卫星） */
  mapMode: VideoMapModeChoice

  /** 是否显示开头钩子字幕 */
  hook: boolean

  /** 是否显示底部数据行字幕 */
  dataLine: boolean

  /**
   * 自定义开头钩子文案（多行，每行一条字幕）。
   * **空串 = 没自定义**，按当前活动数据自动生成——用户清空输入框即可恢复自动。
   */
  hookText: string

  /** 自定义底部数据行文案（多行，每行一条字幕）；语义同上 */
  dataLineText: string
}

/**
 * 字幕自动文案的数据源（活动真实数据；缺失字段整行省略，不伪造）。
 *
 * 面板用它算出「留空时会生成什么」，并在打开时预填进输入框供用户修改。
 */
export interface VideoCaptionData {
  /** 总里程（米） */
  distanceMeters?: number

  /** 总爬升（米） */
  elevationGainMeters?: number

  /** 运动时长（秒） */
  movingSeconds?: number
}

/** 自定义字幕文案的长度上限（字符）：防止误粘贴长文把画面撑爆，也约束存储体积 */
export const CAPTION_TEXT_MAX_LENGTH = 120

/** 面板选择记忆 key（localStorage：跨会话保留用户偏好） */
const VIDEO_EXPORT_SETTINGS_KEY = 'cycling-video-export-settings'

/** 默认选项：竖屏 + 30 秒 + 跟随当前底图 + 双字幕都开（方案 B 已确认）+ 文案走自动 */
export const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = {
  aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
  duration: '30',
  mapMode: 'follow',
  hook: true,
  dataLine: true,
  hookText: '',
  dataLineText: '',
}

/** 比例选项（顺序即面板顺序，首个为默认） */
export const ASPECT_OPTIONS: readonly { value: VideoAspectRatio; label: string }[] = [
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横屏' },
]

/** 时长选项（「跟随里程」约每 5 km 1 秒，夹在 15~60 秒） */
export const DURATION_OPTIONS: readonly { value: VideoDurationChoice; label: string }[] = [
  { value: '15', label: '15 秒' },
  { value: '30', label: '30 秒' },
  { value: '60', label: '60 秒' },
  { value: 'distance', label: '跟随里程' },
]

/** 底图选项：只列视频支持的三种，不暴露「卫星+路网」避免面板过载（跟随当前即可命中它） */
export const MAP_MODE_OPTIONS: readonly { value: VideoMapModeChoice; label: string }[] = [
  { value: 'follow', label: '跟随当前' },
  { value: 'normal', label: '正常' },
  { value: 'satellite', label: '卫星' },
]

/**
 * 取值是否属于给定候选列表。
 *
 * @param value 待校验值（来自 JSON，类型未知）
 * @param options 候选列表
 */
function inOptions<T extends string>(value: unknown, options: readonly { value: T }[]): value is T {
  return typeof value === 'string' && options.some((option) => option.value === value)
}

/**
 * 校验并截断自定义字幕文案：非字符串或超长时回退空串（= 自动生成）。
 *
 * @param value 待校验值
 */
function readCaptionText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, CAPTION_TEXT_MAX_LENGTH) : ''
}

/**
 * 从 localStorage 读取记忆的导出选项（无记忆/解析失败/存储不可用均回退默认）。
 * 逐字段校验：单个字段非法只回退该字段，不整条丢弃。
 */
export function loadVideoExportSettings(): VideoExportSettings {
  try {
    const raw = localStorage.getItem(VIDEO_EXPORT_SETTINGS_KEY)
    if (raw === null) {
      return DEFAULT_VIDEO_EXPORT_SETTINGS
    }
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') {
      return DEFAULT_VIDEO_EXPORT_SETTINGS
    }
    const record = parsed as Partial<VideoExportSettings>
    return {
      aspectRatio: inOptions(record.aspectRatio, ASPECT_OPTIONS)
        ? record.aspectRatio
        : DEFAULT_VIDEO_EXPORT_SETTINGS.aspectRatio,
      duration: inOptions(record.duration, DURATION_OPTIONS)
        ? record.duration
        : DEFAULT_VIDEO_EXPORT_SETTINGS.duration,
      mapMode: inOptions(record.mapMode, MAP_MODE_OPTIONS)
        ? record.mapMode
        : DEFAULT_VIDEO_EXPORT_SETTINGS.mapMode,
      hook: typeof record.hook === 'boolean' ? record.hook : DEFAULT_VIDEO_EXPORT_SETTINGS.hook,
      dataLine:
        typeof record.dataLine === 'boolean'
          ? record.dataLine
          : DEFAULT_VIDEO_EXPORT_SETTINGS.dataLine,
      hookText: readCaptionText(record.hookText),
      dataLineText: readCaptionText(record.dataLineText),
    }
  } catch {
    return DEFAULT_VIDEO_EXPORT_SETTINGS
  }
}

/**
 * 记忆导出选项到 localStorage（存储不可用时静默忽略，不影响本次导出）。
 *
 * @param settings 导出选项
 */
export function storeVideoExportSettings(settings: VideoExportSettings): void {
  try {
    localStorage.setItem(VIDEO_EXPORT_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // 隐私模式等场景下写入失败：仅失去记忆能力，本次导出仍然生效
  }
}
