/**
 * 北京精选热门路线（一期）。
 *
 * 里程与爬升为官方/权威口径（来源逐条标注，禁止凭空估算）：
 * - 妙峰山、潭王路：门头沟区政府官网「中国骑行地图」入选路线公示（2024-11）
 * - 戒台寺：门头沟区「京西骑迹」官方宣传口径（2026-09）
 * 几何为 OSM 路网 Dijkstra 选路产出的简化示意线，见 beijingTracks.ts。
 */
import type { CuratedRoute } from '@/features/curatedRoutes/types'
import { BEIJING_TRACKS } from '@/features/curatedRoutes/beijingTracks'

export const BEIJING_CURATED_ROUTES: CuratedRoute[] = [
  {
    id: 'bj-miaofengshan',
    name: '妙峰山',
    region: 'beijing',
    area: '门头沟',
    distanceMeters: 19700,
    elevationGainMeters: 868,
    difficulty: 4,
    kind: 'climb',
    description:
      '北京「公路车圣地」：以妙峰山牌楼为起点沿妙峰山路登顶，前半程缓升、后半程陡增，连续两年为北京自行车联赛赛段。',
    tips: '3–11 月适宜，5 月底玫瑰谷花期最佳；山顶为死路终点，注意放坡安全；沿线补给点集中在涧沟村。',
    source: '门头沟区政府「中国骑行地图」（2024）',
    tracks: BEIJING_TRACKS.miaofeng ?? [],
  },
  {
    id: 'bj-tanwanglu',
    name: '潭王路',
    region: 'beijing',
    area: '门头沟',
    distanceMeters: 29700,
    elevationGainMeters: 558,
    difficulty: 3,
    kind: 'climb',
    description:
      '连接 G108 与 G109 的京西经典：檀谷·慢闪公园出发，经潭柘寺、十字道至王平镇，蜿蜒曲折、车少景美，坡顶可远眺永定河。',
    tips: '两端起点均有小店补水；回程建议沿 G109 而非京西古道（后者碎石多不适合公路车）。',
    source: '门头沟区政府「中国骑行地图」（2024）',
    tracks: BEIJING_TRACKS.tanwang ?? [],
  },
  {
    id: 'bj-jietaisi',
    name: '戒台寺',
    region: 'beijing',
    area: '门头沟',
    distanceMeters: 4960,
    elevationGainMeters: 213,
    difficulty: 2,
    kind: 'climb',
    description:
      '「骑圈第一课」：从苛罗坨沿 108 国道辅线爬至千年古刹戒台寺，短而友好，是检验进步的打卡赛段。',
    tips: '夏季日均可超 4000 人次骑行；山脚有骑行驿站（补水/简易维修）；可与潭王路串骑。',
    source: '门头沟区「京西骑迹」官方口径（2026）',
    tracks: BEIJING_TRACKS.jietai ?? [],
  },
]
