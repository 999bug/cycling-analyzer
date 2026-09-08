/**
 * 平台导出指引数据（导入向导第 2 步）。
 *
 * 内容与云端教程《批量导出骑行记录教程》同源：
 * https://www.workbuddy.cn/space/d/CE5zQMIX39B2deUsx9IYyf
 *
 * 每个平台一条记录：卡片展示（名称/图标/一句话摘要）+ 指引页内容
 * （步骤列表 steps 或多路径 paths 二选一）+ 导入环节的自适应文案。
 * source 映射回批量导入数据源（ImportSource）：仅 Strava 目录解析
 * activities.csv、佳明解析摘要 JSON，其余来源标题按文件名兜底。
 */
import type { ImportSource } from './importSources';

/** 指引标签色调：positive=绿色（优势），warning=琥珀色（注意/局限） */
export type GuideTagTone = 'positive' | 'warning';

/** 指引标签 */
export interface GuideTag {
  text: string;
  tone: GuideTagTone;
}

/** 多路径指引条目（无单一标准流程的平台，如行者） */
export interface GuidePath {
  /** 路径名（如「App 直接导出（Android PRO）」） */
  title: string;

  /** 路径说明 */
  detail: string;
}

/** 平台导出指引 */
export interface PlatformGuide {
  /** 平台标识（卡片 key 与测试锚点） */
  id: string;

  /** 平台名 */
  name: string;

  /** 图标底色（品牌色近似值） */
  color: string;

  /** 图标文字（首字母/首字） */
  initial: string;

  /** 第 1 步卡片的一句话摘要 */
  summary: string;

  /** 指引页头部的关键信息行（等待时长 · 交付方式 · 格式） */
  meta: string;

  /** 指引页标签 */
  tags: GuideTag[];

  /** 批量导入数据源（决定标题/描述还原策略） */
  source: ImportSource;

  /** 标准步骤指引（与 paths 二选一） */
  steps?: readonly string[];

  /** 多路径指引（与 steps 二选一） */
  paths?: readonly GuidePath[];

  /**
   * 格式说明（导入环节展示）：
   * FIT 为设备原生格式数据完整；GPX 为有损格式，汇总会从轨迹点重新推算。
   */
  formatNote: string;
}

/** 平台指引清单（卡片顺序即展示顺序） */
export const PLATFORM_GUIDES: readonly PlatformGuide[] = [
  {
    id: 'strava',
    name: 'Strava',
    color: '#E24B4A',
    initial: 'S',
    summary: '几分钟 · 邮件交付',
    meta: '几分钟 ~ 数小时 · 邮件交付 · ZIP 内含 .fit.gz / .gpx',
    tags: [
      { text: '导出速度极快', tone: 'positive' },
      { text: '支持整包拖入', tone: 'positive' },
    ],
    source: 'strava',
    steps: [
      '登录 strava.com，右上角头像 → 「设置」',
      '左侧「我的帐户」→ 滚动到底部「下载你的帐户数据」→ 点「开始」',
      '邮箱收到确认邮件，点击确认后开始打包',
      '几分钟后收到第二封邮件，下载 ZIP——回到本页直接拖入，无需解压',
    ],
    formatNote:
      'ZIP 内的 .fit.gz 是 gzip 压缩的 FIT（设备原生数据），精度无损，可直接导入；其中的 .gpx 为有损格式，仅作备用。',
  },
  {
    id: 'garmin',
    name: '佳明 Garmin',
    color: '#0C447C',
    initial: 'G',
    summary: '约 12 小时 · 邮件交付',
    meta: '约 12 小时（最长可能 30 天）· 邮件交付 · ZIP 内含 .fit',
    tags: [
      { text: '需等待较长时间', tone: 'warning' },
      { text: '支持整包拖入', tone: 'positive' },
    ],
    source: 'garmin',
    steps: [
      '电脑登录 garmin.com → 账户 → 数据管理',
      '点击「导出您的数据」→「请求数据导出」',
      '等待邮件（通常 12 小时内，最长可能 30 天）',
      '下载邮件中的 ZIP，进入下一步直接拖入，无需解压',
    ],
    formatNote: '导出包内为 FIT 原生格式，数据完整准确，无需解压整包拖入即可。',
  },
  {
    id: 'xingzhe',
    name: '行者',
    color: '#5F5E5A',
    initial: '行',
    summary: '多条路径，见指引',
    meta: '即时 · GPX · 无官方一键批量导出',
    tags: [{ text: '无官方批量导出', tone: 'warning' }],
    source: 'other',
    paths: [
      {
        title: 'App 直接导出（Android PRO）',
        detail: '运动记录 → 轨迹详情页 → 导出 GPX（需 PRO 会员，仅 Android）',
      },
      {
        title: '轨迹转路书（免费）',
        detail: '轨迹右上角「···」→ 转路书 → 文件管理器 /xingzhe/lushu/export 取 GPX（属路线数据，过程信息不全）',
      },
      {
        title: '网页版逐条导出',
        detail: '登录 imxingzhe.com 个人主页单条导出 GPX，量大时繁琐',
      },
      {
        title: '第三方脚本批量',
        detail: '社区开源工具可批量下载 GPX（需提供账号凭据，注意风险）',
      },
    ],
    formatNote:
      '行者仅能导出 GPX（有损格式）：里程/时长/均速等汇总会从轨迹点重新推算，与 App 显示值存在口径差异（本站已按行者口径对齐时长与爬升）。',
  },
  {
    id: 'igpsport',
    name: 'iGPSPORT',
    color: '#1D9E75',
    initial: 'iG',
    summary: '码表 U 盘即插即拷',
    meta: '即时 · 码表直读 .fit 最省事',
    tags: [{ text: 'U 盘模式可批量', tone: 'positive' }],
    source: 'other',
    steps: [
      '码表关机，数据线 USB 连接电脑（识别为 U 盘）',
      '打开 iGPSPORT 文件夹 → Activities 目录',
      '整批复制 .fit 文件到电脑即可导入；也可 App 内单条导出 FIT / GPX / TCX',
    ],
    formatNote: 'U 盘拷出的是 FIT 原生格式，数据完整准确。',
  },
  {
    id: 'xoss',
    name: 'XOSS',
    color: '#BA7517',
    initial: 'X',
    summary: '码表 U 盘 / App 同步',
    meta: '即时 · 码表直读 .fit',
    tags: [
      { text: 'U 盘模式可批量', tone: 'positive' },
      { text: '码表存储有限，建议定期备份', tone: 'warning' },
    ],
    source: 'other',
    steps: [
      '码表数据线 USB 连接电脑（识别为 U 盘）',
      '打开存储中 activity 文件夹，批量复制 .fit 文件',
      '或 App 绑定 Strava 后借道 Strava 批量导出',
    ],
    formatNote: 'U 盘拷出的是 FIT 原生格式，数据完整准确。',
  },
  {
    id: 'blackbird',
    name: '黑鸟单车',
    color: '#D4537E',
    initial: '鸟',
    summary: 'App 导出 GPX',
    meta: '即时 · App 导出 GPX / 码表导出 FIT',
    tags: [{ text: '无一键批量导出', tone: 'warning' }],
    source: 'other',
    steps: [
      'App 运动记录详情 → 分享/导出 → GPX 文件',
      '黑鸟码表：App 记录管理可导出 .fit 文件',
      '记录多时可用 OTG 直连码表拷贝 FIT 文件',
    ],
    formatNote:
      '码表导出的 FIT 精度最佳；GPX 为有损格式，汇总值由轨迹点推算只能逼近 App 显示值。',
  },
  {
    id: 'magene',
    name: '迈金 Magene',
    color: '#378ADD',
    initial: '迈',
    summary: '建议借道 Strava',
    meta: '借道 Strava 批量导出最省事',
    tags: [{ text: '建议借道 Strava', tone: 'warning' }],
    source: 'other',
    steps: [
      'OnelapFit App 内绑定 Strava 账号',
      '让历史与新记录同步过去',
      '回到本弹窗选择「Strava」，用其官方批量导出一次拿全',
    ],
    formatNote: '经 Strava 批量导出获取的 .fit.gz 为原生数据，精度无损。',
  },
  {
    id: 'coros',
    name: '高驰 COROS',
    color: '#534AB7',
    initial: '高',
    summary: '官方批量导出',
    meta: '官方批量导出 · FIT / TCX 发邮箱',
    tags: [{ text: '有官方批量导出', tone: 'positive' }],
    source: 'other',
    steps: [
      '电脑登录 training.coros.com（Training Hub）',
      '顶部「活动列表」→ 右侧「导出数据」',
      '选择 FIT 或 TCX 格式 + 填入邮箱，文件发送至邮箱',
      '也可 App 运动记录 → 右上角三点 → 导出数据',
    ],
    formatNote: '导出的 FIT 为原生格式，数据完整准确。',
  },
  {
    id: 'keep',
    name: 'Keep',
    color: '#888780',
    initial: 'K',
    summary: '见指引说明',
    meta: '官方导出仅 Excel，不含 GPS 轨迹',
    tags: [{ text: '官方导出无轨迹', tone: 'warning' }],
    source: 'other',
    steps: [
      'App → 我的 → 设置 → 数据安全 → 导出数据（邮件收 Excel，无路线图，无法导入）',
      '需要轨迹需借助第三方模拟登录工具转 FIT / GPX（有账号风险）',
      '更多说明见完整教程',
    ],
    formatNote: '官方 Excel 不含轨迹无法导入；第三方转换的 FIT/GPX 为重建数据，仅供参考。',
  },
];

/**
 * 图文完整教程页路径（public/tutorial/export-guide.html，随站点部署）。
 * BASE_URL 适配 GitHub Pages 子路径部署；页面内各平台章节锚点与
 * PlatformGuide.id 一致，可按 `TUTORIAL_URL#${guide.id}` 深链定位。
 */
export const TUTORIAL_URL = `${import.meta.env.BASE_URL}tutorial/export-guide.html`;

/** 直接导入（未指定平台）的格式说明 */
export const DIRECT_FORMAT_NOTE =
  'FIT 是设备原生格式，数据完整准确；GPX 是有损格式，汇总值由轨迹点重新推算，只能逼近原平台显示值——有 FIT 优先导 FIT。';

/** 直接导入（未指定平台）时的标题还原说明 */
export const DIRECT_SOURCE_NOTE =
  '未指定平台来源：标题按文件名还原；拖入佳明 / Strava 导出包时也会自动识别';
