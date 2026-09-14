/**
 * 精选热门路线数据完整性测试。
 *
 * 精选路线是「事实数据」：里程/爬升必须带权威来源，几何必须存在且与申报量级一致，
 * 防止后续添加路线（二期全国）时混入编造数字或空几何。
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_CURATED_ROUTES,
  CURATED_REGIONS,
  curatedRoutesOf,
} from '@/features/curatedRoutes'
import { BEIJING_TRACKS } from '@/features/curatedRoutes/beijingTracks'
import { NATIONAL_TRACKS } from '@/features/curatedRoutes/nationalTracks'
import { sourceGradeLabel } from '@/features/curatedRoutes/types'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 地球近似：折线长度累加（与路线图页同口径） */
function polylineLengthMeters(track: [number, number][]): number {
  let sum = 0
  for (let i = 1; i < track.length; i += 1) {
    sum += haversineMeters(
      { latitude: track[i - 1]![0], longitude: track[i - 1]![1] },
      { latitude: track[i]![0], longitude: track[i]![1] },
    )
  }
  return sum
}

/** 中国大陆范围的合理坐标界（防坐标错位/写反） */
const CHINA_LAT_RANGE = [18, 54] as const
const CHINA_LNG_RANGE = [73, 135] as const

describe('curatedRoutes 数据完整性', () => {
  it('路线 ID 唯一', () => {
    const ids = ALL_CURATED_ROUTES.map((route) => route.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条路线的必填字段齐全且来源可溯', () => {
    for (const route of ALL_CURATED_ROUTES) {
      expect(route.name.length).toBeGreaterThan(0)
      expect(route.area.length).toBeGreaterThan(0)
      expect(route.description.length).toBeGreaterThan(0)
      expect(route.tips.length).toBeGreaterThan(0)
      // 权威来源标注是硬要求：没有来源的里程不允许上线
      expect(route.source.length).toBeGreaterThan(0)
      expect(route.distanceMeters).toBeGreaterThan(0)
      expect(route.elevationGainMeters).toBeGreaterThan(0)
      expect(route.difficulty).toBeGreaterThanOrEqual(1)
      expect(route.difficulty).toBeLessThanOrEqual(5)
    }
  })

  it('每条路线的几何存在且坐标在中国范围内', () => {
    for (const route of ALL_CURATED_ROUTES) {
      expect(route.tracks.length).toBeGreaterThan(0)
      for (const track of route.tracks) {
        expect(track.length).toBeGreaterThanOrEqual(2)
        for (const [lat, lng] of track) {
          expect(lat).toBeGreaterThanOrEqual(CHINA_LAT_RANGE[0])
          expect(lat).toBeLessThanOrEqual(CHINA_LAT_RANGE[1])
          expect(lng).toBeGreaterThanOrEqual(CHINA_LNG_RANGE[0])
          expect(lng).toBeLessThanOrEqual(CHINA_LNG_RANGE[1])
        }
      }
    }
  }, 30_000)

  it('几何折线长度与申报里程同量级（OSM 简化示意允许偏差，但不允许差一个数量级）', () => {
    for (const route of ALL_CURATED_ROUTES) {
      const drawn = route.tracks.reduce((sum, track) => sum + polylineLengthMeters(track), 0)
      if (route.geometryScope === 'core') {
        // core 路线：路径线仅覆盖核心段，与全程申报里程天然不同量级；
        // 只要求是真实几何（≥500m），量级一致性由「core 标注一致性」用例把关
        expect(drawn).toBeGreaterThan(500)
        continue
      }
      // 妙峰山 OSM 路网比官方口径短约 1/3；容差取 [0.5, 1.6]
      expect(drawn).toBeGreaterThanOrEqual(route.distanceMeters * 0.5)
      expect(drawn).toBeLessThanOrEqual(route.distanceMeters * 1.6)
    }
  }, 30_000)

  it('几何起终点与路线地理常识一致（按地区粗界框，防锚点错位类错误）', () => {
    // 粗界框 = 该地区行政范围 + 余量（不是主城区范围）：
    // 下辖的县市/远郊景区也必须能落进来，否则会把金佛山、石臼湖这类
    // 真实远郊路线误判成锚点错位。新增地区时在此登记
    const REGION_BBOX: Record<string, { lat: [number, number]; lng: [number, number] }> = {
      // 北京全域（房山十渡 → 延庆官厅、昌平 → 门头沟）
      beijing: { lat: [39.63, 40.7], lng: [115.57, 116.69] },
      // 西安：蓝田 → 周至、鄠邑秦岭 → 临潼
      xian: { lat: [33.64, 34.45], lng: [108.47, 109.52] },
      // 杭州：西湖/龙井 → 临安天目山、淳安千岛湖
      hangzhou: { lat: [29.86, 30.44], lng: [119.38, 120.28] },
      // 台州：仙居 → 玉环、三门 → 温岭
      taizhou: { lat: [28.26, 29.29], lng: [120.78, 121.48] },
      // 深圳：梧桐山北路一带
      shenzhen: { lat: [22.46, 22.77], lng: [113.79, 114.59] },
      // 成都：龙泉驿 G318 上山段
      chengdu: { lat: [30.25, 31.23], lng: [103.18, 104.37] },
      // 昆明：西山前山公路（碧鸡关 → 猫猫箐）
      kunming: { lat: [24.32, 26.04], lng: [102.43, 103.40] },
      // 上海：佘山 → 崇明岛（含环崇明、环淀山湖）
      shanghai: { lat: [30.87, 31.78], lng: [120.88, 121.97] },
      // 重庆：主城 → 南川金佛山、长寿湖、武隆仙女山
      chongqing: { lat: [29.36, 29.86], lng: [105.87, 106.74] },
      // 广州：从化流溪河 → 南沙、增城 → 花都
      guangzhou: { lat: [22.86, 23.80], lng: [113.15, 113.88] },
      // 武汉：黄陂木兰山 → 江夏梁子湖
      wuhan: { lat: [30.07, 30.92], lng: [114.00, 114.90] },
      // 厦门：环东海域浪漫线 → 同安汀溪
      xiamen: { lat: [24.41, 24.97], lng: [117.95, 118.29] },
      // 大理：环洱海 → 剑川沙溪、云龙诺邓、宾川鸡足山
      dali: { lat: [25.21, 26.89], lng: [99.23, 100.59] },
      // 海南：环岛各段（东方尖峰 → 文昌）+ 五指山/黎母山/吊罗山
      hainan: { lat: [18.21, 20.06], lng: [108.69, 110.82] },
      // 青岛：环崂山 → 西海岸唐岛湾、平度莱西湖
      qingdao: { lat: [35.63, 37.00], lng: [119.81, 120.71] },
      // 青海湖：环湖公路全域（二郎剑 → 刚察/哈尔盖）+ 茶卡方向
      qinghai: { lat: [36.55, 37.35], lng: [99.06, 101.00] },
      // 南京：玄武 → 石臼湖、六合金牛湖
      nanjing: { lat: [31.21, 32.48], lng: [118.56, 119.08] },
    }
    for (const route of ALL_CURATED_ROUTES) {
      const bbox = REGION_BBOX[route.region]
      expect(bbox).toBeDefined()
      const points = route.tracks.flat()
      for (const [lat, lng] of points) {
        expect(lat).toBeGreaterThan(bbox!.lat[0])
        expect(lat).toBeLessThan(bbox!.lat[1])
        expect(lng).toBeGreaterThan(bbox!.lng[0])
        expect(lng).toBeLessThan(bbox!.lng[1])
      }
    }
  }, 30_000)

  it('注册表与数据文件互相一致', () => {
    expect(CURATED_REGIONS.map((region) => region.id)).toEqual([
      'beijing',
      'xian',
      'hangzhou',
      'taizhou',
      'shenzhen',
      'chengdu',
      'kunming',
      'shanghai',
      'chongqing',
      'guangzhou',
      'wuhan',
      'xiamen',
      'nanjing',
      'dali',
      'hainan',
      'qingdao',
      'qinghai',
    ])
    // 每个地区的路线集合 = 数据文件全集（无遗漏、无重复收录）
    for (const region of CURATED_REGIONS) {
      expect(curatedRoutesOf(region.id)).toEqual(region.routes)
    }
    // 北京路线的 tracks 引用必须指向生成数据里真实存在的 key（bj-<id> → 生成脚本短名）
    expect(Object.keys(BEIJING_TRACKS).sort()).toEqual([
      'bll',
      'cby',
      'cf',
      'dc',
      'dfh',
      'gyk',
      'hcl',
      'hhc',
      'hjl',
      'hsl',
      'hsl2',
      'jietai',
      'jzs',
      'miaofeng',
      'ms',
      'sb',
      'sh',
      'tanwang',
      'yts',
      'yxh',
    ])
    // 全国路线的生成 key（fxl/lj/kcs/wts/lqs/mmq）
    expect(Object.keys(NATIONAL_TRACKS).sort()).toEqual([
      'cd-chengjia-tea',
      'cd-chongqing-road',
      'cd-haute-s1',
      'cd-haute-s2',
      'cd-huancheng-greenway',
      'cd-jinjiang-greenway',
      'cd-longquan-climb-race',
      'cd-longquan-loop',
      'cd-luodai',
      'cd-panda',
      'cd-pengzhou-bailu',
      'cd-qingcheng-dujiang',
      'cd-qingcheng-full',
      'cd-wenjiang-beilin',
      'cd-xiling-huashuiwan',
      'cd-zhaogongshan-loop',
      'chongming',
      'cq-babin',
      'cq-binjiang-full',
      'cq-chashanzhuhai',
      'cq-geleshan',
      'cq-jinyun',
      'cq-liangjiang',
      'cq-liangjiang-greenway2',
      'cq-nanbin',
      'cq-nanshan',
      'cq-qiaopingshan',
      'cq-zhaomu',
      'dianshanhu',
      'dl-cangshan-round',
      'dl-dali-lijiang',
      'dl-dali-nuodeng',
      'dl-dali-shaxi',
      'dl-dali-weishan',
      'dl-dali-xizhou',
      'dl-erhai-east',
      'dl-erhai-loop',
      'dl-erhai-west',
      'dl-jizushan',
      'dl-jizushan-climb',
      'dl-shaxi-stone',
      'dl-shuanglang-xizhou',
      'dl-xizhou-dali',
      'dl-zibi-lake',
      'fulushan',
      'fxl',
      'gz-baiyunshan',
      'gz-dafushan',
      'gz-ersha',
      'gz-guangfu',
      'gz-haioudao',
      'gz-huadu',
      'gz-huaduhu',
      'gz-huolushan',
      'gz-kexuecheng',
      'gz-licha',
      'gz-liuxihe',
      'gz-maofeng',
      'gz-nangang',
      'gz-paitan',
      'gz-xinzhongzhou',
      'gz-yinggu',
      'gz-zengjiang',
      'hn-bawangling',
      'hn-changjiang-danzhou',
      'hn-chengmai-haikou',
      'hn-danzhou-chengmai',
      'hn-diaoluo',
      'hn-haikou-wenchang',
      'hn-jianfeng',
      'hn-limushan',
      'hn-lingshui-sanya',
      'hn-qiongzhong-tunchang',
      'hn-qiongzhong-wanning',
      'hn-sanya-baoting',
      'hn-sanya-wuzhishan',
      'hn-tunchang-haikou',
      'hn-wanning-lingshui',
      'hn-wenchang-boao',
      'hn-wuzhishan-qiongzhong',
      'hz-anding',
      'hz-dongziguan',
      'hz-gongwang',
      'hz-guchengmen',
      'hz-jingshan',
      'hz-liangzhu',
      'hz-longjing',
      'hz-qianjiang',
      'hz-qingshanhu',
      'hz-tianmushan',
      'hz-tongjianhu',
      'hz-wenchao',
      'hz-xianghu',
      'hz-xihu',
      'hz-yinghua',
      'hz-zhongbu',
      'jiabei',
      'jiufeng',
      'kcs',
      'km-anning-wenquan',
      'km-baozhusi-climb',
      'km-dianchi-greenway',
      'km-dongchuan-guniu',
      'km-fuxianhu',
      'km-gaohai-road',
      'km-jiaozishan-172',
      'km-jindian-yeyahu',
      'km-liangwangshan',
      'km-qingxiaxia',
      'km-shilin-changhu',
      'km-xundi-fenglongwan',
      'km-yangzonghai-40',
      'km-yiliang-68',
      'km-yiliang-jiuxiang',
      'lj',
      'lqs',
      'mmq',
      'nj-guli',
      'nj-hexi-binjiang',
      'nj-jinniuhu',
      'nj-laoshan',
      'nj-longshang-dashan',
      'nj-ming-wall-outer',
      'nj-qixia-mountain',
      'nj-shecun',
      'nj-shijiu-lake',
      'nj-shitang',
      'nj-wuxiang-mountain',
      'qd-badaguan',
      'qd-cangmashan',
      'qd-century',
      'qd-huan-lao',
      'qd-huanwan',
      'qd-laixihu',
      'qd-lianhua',
      'qd-liuqing-yakou',
      'qd-shazikou-yangkou',
      'qd-shiulaoren-yangkou',
      'qd-wanggezhuang-yangkou',
      'qh-erlangjian-jiangxigou',
      'qh-erlangjian-niaodao',
      'qh-gangca-haergai',
      'qh-haergai-xihai',
      'qh-heimahe-chaka',
      'qh-heimahe-shinaihai',
      'qh-jiangxigou-heimahe',
      'qh-shandidao',
      'qh-tongbao',
      'qh-xihai-jinyintan',
      'qh-xihai-tongbao',
      'sh-changing-outer-ring',
      'sh-dishui-lake',
      'sh-gucun-park',
      'sh-huangpu-east-bank',
      'sh-miaojiang-road',
      'sh-pujiang-countryside',
      'sh-putuo-suhe',
      'sh-wusongkou',
      'sheshan',
      'sz-dadingshan',
      'sz-dashahe',
      'sz-dayun',
      'sz-fenghuangshan',
      'sz-futianhe',
      'sz-gankeng',
      'sz-guanlan',
      'sz-haibei',
      'sz-lixinhui',
      'sz-luohu5',
      'sz-maluan',
      'sz-shenzhenwan',
      'sz-shihu',
      'sz-taojin',
      'sz-xilihu',
      'sz-yangmeikeng',
      'sz-yantian-haibin',
      'sz-yinhu',
      'tz-fangshan',
      'tz-feilonghu',
      'tz-fengshan',
      'tz-hanshanhu',
      'tz-kuocang',
      'tz-linghu',
      'tz-shifengxi',
      'tz-tiantai',
      'tz-wugen',
      'tz-yongningjiang',
      'tz-youxi',
      'wh-bafenshan',
      'wh-donghu-huzhongdao',
      'wh-donghu-loop',
      'wh-dugonghu',
      'wh-fuhe',
      'wh-houguanhu-20',
      'wh-jinyinhu',
      'wh-liangzihu',
      'wh-longquan-18',
      'wh-longquan-80',
      'wh-luhu',
      'wh-moshan-climb',
      'wh-mulan-dadao',
      'wh-qingshan-wetland',
      'wh-tangxunhu',
      'wh-tianxingzhou',
      'wh-wenjin',
      'wh-zhanggongdi',
      'wts',
      'xa-chanba-loop',
      'xa-changan-cityloop',
      'xa-changan-greenway',
      'xa-citywall',
      'xa-cuihua-climb',
      'xa-cuihua-round',
      'xa-fengyu-return',
      'xa-kunmingchi',
      'xa-languan',
      'xa-lintong',
      'xa-lishan-loop',
      'xa-qinling-fengyu-climb',
      'xa-sanhe-chanba',
      'xa-taiping-zhuque',
      'xa-weihe-city',
      'xa-weihe-xixian',
      'xm-beichen',
      'xm-dongping',
      'xm-huandao',
      'xm-huandong',
      'xm-huandong-tongan',
      'xm-junying',
      'xm-kongzhong',
      'xm-lansidai',
      'xm-maqinglu',
      'xm-tianmashan',
      'xm-tianzhu',
      'xm-tingxi',
      'xm-wenzeng',
      'xm-xinglinwan',
      'xm-yuandang',
    ])
    for (const route of ALL_CURATED_ROUTES) {
      expect(route.tracks.length).toBeGreaterThan(0)
    }
  })

  it('每条路线都带来源等级，且等级文案映射正确', () => {
    for (const route of ALL_CURATED_ROUTES) {
      expect(['A', 'B', 'C']).toContain(route.sourceGrade)
    }
    expect(sourceGradeLabel('A')).toBe('官方口径')
    expect(sourceGradeLabel('B')).toBe('权威媒体')
    expect(sourceGradeLabel('C')).toBe('社区码表')
  })

  it('长距离环线/往返路线必须标注 core 几何口径（路径线仅覆盖核心段）', () => {
    for (const route of ALL_CURATED_ROUTES) {
      const drawn = route.tracks.reduce((sum, track) => sum + polylineLengthMeters(track), 0)
      // full 路线的量级下限是 0.5（见上一用例）：低于下限却标 full 即为漏标
      if (drawn < route.distanceMeters * 0.5) {
        expect(route.geometryScope).toBe('core')
      }
    }
  })
})
