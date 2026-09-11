/**
 * 全国精选热门路线（二期里程碑 2）：西安 / 杭州 / 台州 / 深圳 / 成都 / 昆明各 1 条。
 *
 * 数据口径同 beijing.ts：里程/爬升带权威来源与三级可信度标注，
 * 几何由 scripts/generate-curated-routes.mjs 从 OSM 路网产出（nationalTracks.ts）。
 */
import { NATIONAL_TRACKS } from '@/features/curatedRoutes/nationalTracks'
import type { CuratedRoute } from '@/features/curatedRoutes/types'

export const NATIONAL_CURATED_ROUTES: CuratedRoute[] = [
  {
    id: 'xa-fenshuiling',
    name: '秦岭分水岭',
    region: 'xian',
    area: '长安 · 秦岭',
    distanceMeters: 34280,
    elevationGainMeters: 1595,
    difficulty: 5,
    kind: 'climb',
    description:
      '西安爬坡的终极试炼：沿 G210 从沣峪口一路爬升至长江黄河分水岭垭口（海拔约 2030m），34km 连续爬升，陕西车友的「驾考」路线。',
    tips: '垭口气温比市区低 8–10°C 带防风；沣峪内村镇可补水；周末车流大建议早出发；冬季背阴路面可能结冰。',
    source: '中国秦岭分水岭自行车爬坡赛规程',
    sourceGrade: 'B',
    tracks: NATIONAL_TRACKS.fxl ?? [],
  },
  {
    id: 'hz-longjingbei',
    name: '龙井北坡',
    region: 'hangzhou',
    area: '西湖景区',
    distanceMeters: 2600,
    elevationGainMeters: 130,
    difficulty: 2,
    kind: 'climb',
    description:
      '杭州市区最友好的刷坡路：从龙井路口沿龙井路盘旋至龙井村，茶山夹道、坡度均匀，日常训练与休闲骑两相宜。',
    tips: '坡度均匀（5% 上下），适合入门刷坡；3–5 月茶季游客多注意行人；可串满觉陇路、龙井西路组成小环线。',
    source: '捷安特官方骑游地图（均坡 5.05%）',
    sourceGrade: 'B',
    tracks: NATIONAL_TRACKS.lj ?? [],
  },
  {
    id: 'tz-kuocangshan',
    name: '括苍山',
    region: 'taizhou',
    area: '临海',
    distanceMeters: 26310,
    elevationGainMeters: 1490,
    difficulty: 5,
    kind: 'climb',
    description:
      '浙东最高峰的进阶爬坡：沿风电公路盘旋登顶括苍山（米筛浪 1382m），云海与风车阵列是台州骑友的年度朝圣。',
    tips: '26km 平均坡度 5.4%，山顶温差大必带防风；山顶无补给，出发前在山下吃饱；清晨云海概率高。',
    source: '野途网爬坡赛段（均坡 5.36%）',
    sourceGrade: 'B',
    tracks: NATIONAL_TRACKS.kcs ?? [],
  },
  {
    id: 'sz-wutongshan',
    name: '梧桐山',
    region: 'shenzhen',
    area: '罗湖',
    distanceMeters: 6280,
    elevationGainMeters: 533,
    difficulty: 4,
    kind: 'climb',
    description:
      '深圳市区最近的硬核爬坡：沿梧桐山北路盘旋至好汉坡，平均坡度 8.5%，深圳车友的晨练打卡地。',
    tips: '全年可骑，夏季高温建议清晨出发；山上补水点有限；下坡弯多路窄控速，周末晨间行人和车都多。',
    source: '野途网爬坡赛段（均坡 8.46%）',
    sourceGrade: 'B',
    tracks: NATIONAL_TRACKS.wts ?? [],
  },
  {
    id: 'cd-longquanshan',
    name: '龙泉山 A 面',
    region: 'chengdu',
    area: '龙泉驿',
    distanceMeters: 7700,
    elevationGainMeters: 370,
    difficulty: 3,
    kind: 'climb',
    description:
      '成都平原东缘的日常练坡场：沿 G318 老路上山至山泉镇（桃花故里），春季桃李花开时风景最佳。',
    tips: '3 月桃花季车流人流大注意安全；坡度舒缓适合入门耐力训练；可与下坡串成环线，山顶有农家乐补给。',
    source: '成都骑行社区攻略（坡度 2–6%）',
    sourceGrade: 'C',
    tracks: NATIONAL_TRACKS.lqs ?? [],
  },
  {
    id: 'km-maomaoqing',
    name: '西山猫猫箐',
    region: 'kunming',
    area: '西山',
    distanceMeters: 6000,
    elevationGainMeters: 436,
    difficulty: 4,
    kind: 'climb',
    description:
      '春城最近的看海爬坡：盘山公路爬上西山猫猫箐村，回望滇池与昆明城景，四季如春的打卡坡。',
    tips: '全年适宜，冬季清晨路面可能有霜注意防滑；山顶村落有农家补给；紧邻西山风景区，节假日车多。',
    source: '昆明信息港实测里程 + 骑行码表爬升口径',
    sourceGrade: 'C',
    tracks: NATIONAL_TRACKS.mmq ?? [],
  },
]
