# 项目进度与功能状态

> 本文档记录骑行数据分析网站（cycling-analyzer）的功能实现状态、架构边界与接口约定，
> 供后续开发（含 AI agent）继续工作参考。最后更新：2026-08-25（赛段 GPX 导入卡死修复：Worker 化 + 路径校验降复杂度 + 迷你地图懒加载，版本 2.19.0）。
>
> **维护规则**：每完成一个功能/阶段必须同步更新本文档（状态与文件清单），
> 再提交代码；进行中的任务标注"🔄 运行中"并注明负责 agent。
> **每个任务开始前先登记到 §0 进行中任务清单，完成后移出**（防中断丢失进度）。
>
> 产品规格原文：`docs/个人骑行数据分析网站——Agent 开发规格说明.md`（规格 §N 引用即该文档章节）。

---

## 0. 进行中任务清单（中断恢复必读）

> 用途：任务中途因上下文满 / 费用不足 / 手动停止而中断时，agent 先读本节定位进度，
> 避免重复工作或遗漏。**每开始一个新任务在此登记；每完成一步更新状态；全部完成并提交后移除**。

| 状态 | 任务 | 进度 | 下一步 |
|---|---|---|---|
| ✅ 已提交 | **GPX 活动导入（第二数据格式入口）**（产品评审结论：活动导入只认 FIT 覆盖面窄，手机骑行 App 用户只有 GPX；赛段已支持 GPX，扩展到活动导入） | ①新建 `src/gpx/gpxParser.ts`（与 FIT 解码平行的第二入口：getElementsByTagNameNS 局部名匹配解析 trkpt lat/lon/ele/time + TrackPointExtension hr/cad/atemp/power——getElementsByTagName 匹配限定名查不到带前缀扩展标签；累计距离按相邻点 haversine 累加，乱序轨迹时间排序防御；汇总复用 @/fit/calculator calculateSummary，速度不伪造恒 undefined；gpx creator → device.productName、trk type → activityType 缺省 cycling、trk name → Activity.name）；②scanner 增 isActivityFileName/isGpxFileName（.fit/.fit.gz/.gpx/.gpx.gz 统一入口），collectFitFiles/scanDirectory 改用；③importer 按扩展名分发解析器（批次内懒选择：GPX 主线程动态 import 独立分包不进首屏——DOMParser 无 Worker 版；FIT 仍走 worker 链每批一个），标题优先级插入 activity.name（手动 > CSV > GPX 内部名 > 文件名兜底）；④stravaExport titleFromFileName 正则扩展 .gpx/.gpx.gz（纯数字跳过规则复用）；⑤ImportPanel accept=.fit,.fit.gz,.gpx + 文案更新（选择文件/拖拽区/未找到提示）+ e2e smoke 选择器同步；⑥测试：tests/gpx/gpxParser.test.ts 12 用例（字段映射/haversine 赤道基准/缺失容错/多 trkseg/错误分支）+ scanner 4 新增（原「忽略非 FIT」断言改为 gpx 收集）+ importerGpx 6 端到端（标题链/.gpx.gz 解压/指纹判重一致/损坏失败台账/FIT+GPX 混合批次分发） | 全量 896/896 + lint/build 绿；版本 2.17.0 → 2.18.0，changelog 已追加 |
| ✅ 已提交 | **赛段迷你地图 + 路径校验**（用户反馈：导入 GPX 后赛段卡片信息太少、35 秒爬妙峰山明显误匹配） | ①SegmentEntity 加可选 trackPoints（非索引字段免升 DB_VERSION），parseSegmentGpx 存完整轨迹；②segmentMatching.ts 新增 trackMatchesPath（活动穿越起终点圆之间的 GPS 点到赛段轨迹中位数距离 ≤ 100m 才计成绩，无轨迹退化仅圆匹配）；③新建 SegmentMiniMap.tsx（Leaflet 迷你地图，有轨迹画折线/无轨迹画起终点标记，fitBounds 禁交互，OSM→高德降级）；④SegmentCards.tsx 卡片顶部嵌迷你地图 + sourceIndex/onMapFallback 透传；⑤SegmentsPage.tsx 瓦片源 state + 降级记忆（sessionStorage 共享 key）；⑥segmentCards.css 补 .segment-card__map 样式 | 全量 874/874 + lint/build 绿；版本 2.16.0 → 2.17.0，changelog 已追加 |
| ✅ 已提交 | **赛段 GPX 文件导入**（用户反馈：无 Strava 订阅无法创建 API 应用；改走免费路径——Strava 赛段页免费导出 GPX，本地解析建赛段） | ①`stravaSegments.ts` 增 `parseSegmentGpx`（DOMParser 解析 trkpt 首末点为起终点圆 + trk/metadata name 兜底文件名）与 `filterNewGpxSegments`（名称+起终点坐标 5 位小数去重）；②SegmentsPage 导入面板加 GPX 文件选择（支持多选），解析入库计数反馈；③纯函数测试 + 页面上传流程测试 | 全量 874/874 + lint/build 绿；版本 2.15.0 → 2.16.0，changelog 已追加 |
| ✅ 已提交 | **Strava 赛段导入 + 自动匹配**（用户需求：不想手动设赛段，直接拉 Strava 已有赛段按起终点自动匹配成绩） | ①`src/features/segments/stravaSegments.ts` 纯函数模块（Strava API 类型/分页拉收藏赛段 fetchStarredSegments、范围探索 fetchExploreSegments、映射 SegmentEntity 带 stravaId、filterNewSegments 按 stravaId 去重、trackBounds 由活动逐点算 explore bounds）；②SegmentEntity 加可选 stravaId（非索引字段免升 DB_VERSION）；③SegmentsPage 本地模式折叠面板「从 Strava 导入赛段」：token 输入框存 localStorage + 过期提示、「导入收藏赛段」按钮、「按活动探索」选活动算 bounds 再探索，去重入库；④单测 mock fetch 覆盖映射/去重/bounds/UI 流程 | 全量 867/867 + lint/build 绿；版本 2.14.0 → 2.15.0，changelog 已追加；待提交推送 |
|---|---|---|---|
| ✅ 已提交 | **作者源只读提示优化 + 作者赛段导出工作流**（用户反馈：详情页「设为赛段」按钮消失） | 根因：快照发布成功后线上默认落在作者源（只读），写操作按钮按设计隐藏但无任何提示。①`ActivityDetailPage.tsx`：作者源下「重命名 / 设为赛段 / 删除活动」不再隐藏，改为置灰 disabled + title 提示「切换到我的数据后操作」（CSS 补 rename-trigger disabled 态）；②新增 `src/features/segments/authorSegmentsExport.ts` 纯函数（本地赛段 → author-data/segments.json 格式 JSON + 浏览器下载），`SegmentsPage.tsx` 本地模式工具条加「导出作者赛段 JSON」按钮（无赛段禁用），作者模式空态文案补作者工作流引导；③测试：activityDetailPage 作者模式断言改可见+禁用+title、segmentsPage 新增导出按钮/无赛段禁用 2 用例；④changelogData.ts 追加 2.14.0 条目，版本 2.13.0 → 2.14.0 | push 触发 CI |
| ✅ 已提交 | **版本更新日志页面**（用户需求：页面上一目了然看到每个版本新增功能） | ①新建 `src/features/changelog/changelogData.ts`：近期版本功能清单静态数据（倒序维护，每版发布时在头部追加）；②新建 `src/pages/ChangelogPage.tsx` + CSS：时间线卡片展示版本徽章/日期/功能列表，当前运行版本（`__APP_VERSION__`）高亮品牌色左边线 + 「当前版本」徽章；③路由 `/changelog`（ROUTES[12] 懒加载）+ 侧边栏导航「更新日志」+ 底部版本号改可点击链接直达本页（hover 提示）；④测试 `tests/pages/changelogPage.test.tsx` 4 用例（标题引导/全量条目倒序/当前版本徽章唯一/功能列表抽查），全量 852/852 + lint/build 绿；⑤版本 2.12.0 → 2.13.0 | push 触发 CI |
| ✅ 已提交 | **赛段排行榜 UI 增强 + 有氧效率趋势**（用户确认开发；无功率计场景） | ①`SegmentCards.tsx` 展开完整成绩排行列表（`<ol>` 排名/日期/用时整行链接详情，按用时升序 = 排名顺序，空榜显示「暂无穿越记录」；本地与作者快照双源一致生效）；②新建 `src/features/analysis/aerobicEfficiency.ts` 纯函数：AE = 平均速度 ÷ 平均心率，按自然月时长加权（Σ速度×时长 ÷ Σ心率×时长），输出连续 N 月序列、空月 value=undefined 不伪造；③`PerformancePage.tsx` 新增「有氧效率趋势」区块：Recharts LineChart 近 12 月 AE + 4 月移动平均虚线，全部月份无可参与活动（缺平均速度或平均心率）时整块隐藏；④测试：新增 `tests/features/analysis/aerobicEfficiency.test.ts` 4 用例 + `segmentsPage.test.tsx` 补完整排行断言（排名/日期/用时/链接），全量 848/848 + lint/build 绿；⑤版本 2.11.0 → 2.12.0 | push 触发 CI |
| ✅ 已提交 | **分段剖面悬停 Tooltip 速度/功率/心率改显示实时值**（用户需求：悬停点处的实时速度/功率/心率，非整段平均；功率为空则整行不显示） | ①`segmentsProfile.ts` `SegmentProfilePoint` 增可选 `speed?/power?/heartRate?`，`buildSegmentProfile` 构建点时从原始 `ActivityRecord` 携带（simplifyRoute 保留完整记录，抽稀不影响字段）；②`SegmentsSection.tsx` `SegmentTooltipContent` 速度/功率/心率三行改用 `point.*` 悬停点实时值，功率 `undefined` 时整行不 push（连标签都不渲染——功率计缺失常见场景），速度/心率为空仍显示 `—`；③测试：双爬坡纯函数用例补实时值携带断言 + 无速度/功率/心率记录剖面点字段 undefined 断言，新增无功率爬坡悬停用例（实时 18.0 km/h / 150 bpm，功率行整体隐藏），全量 844/844 + lint/build 绿；④版本 2.10.0 → 2.11.0 | push 触发 CI |
| ✅ 已提交 | **详情页图表合并为多指标开关曲线卡**（用户需求：地图下方一张「数据曲线」卡，速度/踏频/海拔/温度等指标开关切换，默认海拔；悬停 Tooltip 显示全部已开指标；去掉「速度+心率」组合卡；保留爬坡与分段分析） | ①新增 `src/charts/multiMetricSeries.ts` 纯函数（`MULTI_METRIC_META` 六指标元数据/`availableMetrics` 可用指标探测/`buildMultiMetricSeries` 多指标对齐序列/`metricRanges`+`buildMultiMetricRenderData` 各指标独立归一化到 [0,1] 渲染数据，恒值 0.5、缺失 undefined 断线，原始值随点携带供 Tooltip）；②新增 `src/charts/MultiMetricChart.tsx`（指标 chip 开关组 aria-pressed + ComposedChart 归一化叠加——海拔面积渐变、其余折线、Y 轴隐藏 `norm_` 扁平字符串键规避 recharts 函数式 dataKey TS 限制 + 自定义 Tooltip 按已开指标展示真实数值（缺失 `—`）+ 距离/时间轴切换 + 共享时间轴 memo 子树 + 自悬停抑制 + downsample ≤1000 点；默认海拔、无海拔取首个可用指标，`enabled = (userEnabled ?? 默认) ∩ available` 防活动切换过期选择；全关/无数据引导文案）+ `multiMetric.css`；③`ActivityDetailPage` 换接线（多指标卡 + PowerCurveChart + 训练区间内心率图），删除 SpeedChart/CadenceChart/ElevationChart/PowerChart/TemperatureChart/CombinedChart 六个封装及 series.ts 组合图遗留（buildCombinedSeries 等）与对应 3 个测试文件；④新测试 `multiMetricChart.test.tsx` 16 用例（纯函数 11 + 组件 5，jsdom mock getBoundingClientRect 必须含 left/top）+ 详情页测试更新 4 处（数据曲线卡断言/仅功率数据默认开功率/轨迹着色组 within 作用域——与指标 chip 同名/心率 heading 断言）；⑤lint/build 绿 + 全量 843/843（PowerShell 通道：bash 下 vitest 4 因宿主进程注入 runner 上下文丢失，全量 0 用例执行，与代码无关）；⑥版本 2.9.0 → 2.10.0 | push 触发 CI |
| ✅ 已提交 | **分段剖面图 Recharts 化（对齐海拔卡片交互）**（用户需求：剖面效果与「海拔」卡片一致——悬浮弹出详情 + 坡度着色） | ①新增 `src/features/activity/segmentsProfile.ts` 纯函数（抽稀 + 坡度窗口平滑 + 分档着色字段 alt0-4 + 分段下标 + UCI 徽章锚点，gradeBandIndex/segmentIndexAtDistance 可单测）；②`SegmentsSection.tsx` 手绘 SVG 改 Recharts ComposedChart：距离/海拔坐标轴 + 网格 + Brush 缩放 + 自定义 Tooltip 分段详情卡（区间/长度/爬升/坡度/此处海拔/此处坡度/速度/功率/心率）+ ReferenceArea 分段色带（悬停加深）+ ReferenceDot UCI 徽章 + 共享时间轴（onMouseMove 上报 / hoverTimestamp 参考线）；③`segmentsSection.css` 删手绘剖面样式；④**顺带修复 recharts 3 升级遗留 bug**：`activeTooltipIndex` 为字符串导致 MetricChart/分段图 `typeof number` 判断失效、图表悬停不再上报时间戳（共享时间轴联动地图失效），新增 `timeline.ts` `activeTooltipIndexToNumber` 归一化两处共用；⑤测试重写 12 用例（纯函数 8 + 组件 6，jsdom 需 waitFor 等 recharts raf 节流一帧），全量 844/844 + lint/build 绿，版本 2.7.0 → 2.8.0 | push 触发 CI |
| ✅ 已提交 | **分段详情收进剖面悬停卡**（用户反馈：剖面下方「平路 1/爬坡 1…」卡片列表看着乱） | `SegmentsSection.tsx`：删除下方全量分段卡片列表，分段详情（标签/区间/长度/爬升/坡度/此处海拔/速度/功率/心率）全部收进剖面悬停卡——跟随光标、贴近左右边缘自动翻转对齐、`pointer-events: none` 不拦截悬停；悬停圆点 y 跟随剖面高度（原固定顶部）；CSS 删 segment-card 列表样式、新增 tooltip 样式（token 化）；aria-label 与摘要文案同步更新。测试重写：卡片断言改悬停卡断言（jsdom 固定 getBoundingClientRect 模拟 mousemove），全量 839/839 + lint/build 绿，版本 2.6.0 → 2.7.0 | push 触发 CI |
| 🔄 运行中 | **小程序原生重构（零域名方案，见 `docs/小程序原生重构方案.md`）** | Phase 0 ✅ / Phase 1 ✅ / Phase 2 ✅ / Phase 3 ✅ 代码完成。新增：①`scripts/sync-fitsdk.mjs`（fitsdk ESM→CJS，纯 JS 无 WASM，已 Node 驗证真实 .fit 解码）；②`miniprogram/fit/{textDecoderPolyfill,normalize}.js`（TextDecoder polyfill + 移植 normalizer/calculator 算法）；③`miniprogram/repositories/{myRepository,authorRepository}.js`；④导入页接通 wx.chooseMessageFile→解码→本地存储→切源；⑤活动详情页自绘 Canvas 曲线（心率/速度/海拔/功率）；⑥dashboard/activities/detail 按 dataSourceStore 源切换。主包 1.39MB、分包 1.14MB 均达标。<br>**待用户在微信开发者工具验收**：黑屏/点击无响应已修（app.json 分包路径 + 跳转 URL 已修正）；FIT 实际导入需真机聊天文件验证。 | 用户在开发者工具验收导入流程（转发 .fit 到文件传输助手→选文件）；Phase 4 地图 / Phase 5 分享 / Phase 6 优化提审 |
| ✅ 已提交 | **UI 体验改造系列 · 续**（UI-7/UI-8，2026-08-21 下午完成） | ①UI-1~UI-6 ✅ 已推送（版本 2.5.0）；②UI-7 高级指标说明 ✅ `57a45cd`（`MetricHelp` 可复用折叠组件：训练状态 6 条 + 表现趋势 4 条算法解读）；③UI-8 统计页叙事化 ✅ `2527aba`（按「我进步了吗/我骑什么路线/我用什么设备」三问分章重排）；全量 839/839 + lint/build 绿，版本 2.5.0 → 2.6.0，§6.2 UI-1~UI-8 全部 ✅ | 已推送 |
| ✅ 已提交 | **UI 体验改造系列**（2026-08-21 评审立项，任务明细见 §6） | ①UI-1 ✅ `83992ae`；②UI-2 ✅ `9d36a88`；③UI-3 ✅ `290f90c`；④UI-4 ✅ `a39dc1b`；⑤UI-5 ✅ `26e5ea8`；⑥UI-6 ✅ `f361824`（统计卡「最高功率 0 W」→ `—` 规格违例修复、仪表盘「最近骑行」区块、日历可点击格子 hover 暗示）；全量 838/838 + lint/build 绿，版本 2.4.0 → 2.5.0；UI-7/UI-8 留待后续 | 已推送 |
| ✅ 已提交 | **爬坡/分段区块合并 + 悬浮联动 + 表现趋势分析增强**（用户反馈三项） | ①`ClimbSection` 与 `SegmentsSection` 合并为「爬坡与分段分析」区块（`SegmentsSection.tsx` 重构：海拔剖面按坡度着色 + 平路/爬坡色带 + UCI 徽章，下方**平路 + 爬坡全量分段卡片**（修复平路路段无展示），卡片↔色带悬停高亮联动 + 共享时间轴参考线（hoverTimestamp/onHover 透传），剖面视口改 100×100 + preserveAspectRatio=none 使 HTML 徽章坐标精确对齐；删除 ClimbSection.tsx/.css + 旧测试，详情页合并接线）；②表现趋势页（`PerformancePage.tsx`）：**修复 EF 与 TSS 共轴被 TSS 数量级吞没导致的「看不到 EF 线」**（拆独立右轴 + 仅 FTP 时渲染 TSS 轴）、叠加距离/EF 4 周移动平均虚线、周综述卡片加「较上周 ↑/↓」增减、新增 `performanceTrend.ts` `analyzePerformanceTrend`（近 4 周 vs 前 4 周距离/EF/TSS 变化 + 最强周/效率最高周 + 活跃/空周数）与「趋势解读」区块（量化卡片 + 一段式解读文案）；测试 15 新增（segmentsSection 7 重写 + performanceTrend 6 + PerformancePage 断言 2），全量 797/797 + lint/build 绿，版本 2.3.0 → 2.4.0 | push 触发 CI |
| ✅ 已提交 | Strava 描述 + 估算功率展示 + 详情页铺满 | 已提交 `1604b98`（测试 631/631、lint/build 绿、本地快照验证 28 条描述 + 估算功率填充） | push 触发 CI（此前网络异常，随下次提交一起推送） |
| ✅ 已提交 | **详情页三连：共享时间轴联动 + 分段分析 + 骑行质量评分** | 已提交 `9250ae5`（①`src/charts/timeline.ts` + 六图/地图/爬坡剖面共享 hover 联动；②`segments.ts` 平路/爬坡分段 + `climbInsights` 相邻爬坡对比 + SegmentsSection；③`qualityScore.ts` 五维度评分 + QualityScoreSection；测试 36 新增，全量 746/746 + lint/build 绿，版本 2.0.0 → 2.1.0） | 已推送 |
| ✅ 已提交 | **训练计划生成**（功能队列第一项） | 已提交 `6a7db2c`（`src/features/training/plan.ts` + TrainingPlanPage + ROUTES[10] + 侧边栏导航，测试 5/5，全量 746/746 + lint/build 绿） | 随下次一起推送 |
| ✅ 已提交 | **表现趋势（12 周 + 效率因子）**（功能队列第 3 项） | `src/features/analysis/weeklyStats.ts`（`buildWeeklySeries` 周聚合：次数/距离/时长/爬升/TSS/EF）+ 新页 `/performance`（`PerformancePage` 周综述对比 + 12 周趋势图，EF = ΣNP×时长/Σ心率×时长，FTP 缺失隐藏 TSS）；测试 8 + 页面 4 新增 | 随本次提交推送 |
| ✅ 已提交 | **每周训练综述**（功能队列第 7 项） | 并入表现趋势页（`buildWeekReview` 本周 vs 上周对比卡片，与表现趋势同页展示） | 随本次提交推送 |
| ✅ 已提交 | **轨迹纠偏（GPS 漂移点清理）**（功能队列第 9 项） | `src/features/activity/trackCleanup.ts`（`cleanTrackDrift`：两侧瞬时速度均 >50m/s 判飞点剔除，保守不误删单侧高速段；详情页地图与 GPX 导出使用清理后轨迹，提示条展示清理数）；测试 8 新增 | 随本次提交推送 |
| ✅ 已提交 | **自行车统计（FIT 提取单车字段）**（功能队列第 10 项） | FIT session `sportProfileName`（字段 110）→ `Activity.bikeName`（decoder/normalizer/模型/DB/仓库全链路）+ `bikeStats.ts` `buildBikeStats`（缺失归「未知自行车」）+ `BikeStatsCards` 挂统计页设备区块后 + fixture 加单车名重生成；测试 5 + 页面 2 + normalizer 断言新增 | 随本次提交推送 |
| ✅ 已提交 | **离线地图（瓦片 IndexedDB 缓存）**（功能队列第 5 项） | `src/storage/tileCache.ts`（LRU 淘汰：字节 100MB + 条数 20000 双上限，OSM/高德子域归一化 key；缺省上限可注入便于测试）+ `src/map/CachingTileLayer.tsx`（自定义 Leaflet TileLayer 覆写 `createTile`：缓存命中→Blob URL 显示，未命中 fetch(cors) 缓存后显示，失败回退原生加载使 tileerror 触发现有 OSM→高德降级；`createTileLayerComponent` 包装为 React 组件）+ `FallbackTileLayer` 唯一入口接入 + 设置页「离线地图」区（瓦片缓存开关 + 统计 + 清空按钮）+ settings `offline` 域（`tileCacheEnabled` 默认开）+ `useOfflinePreferences` hook；**PWA 图标 `public/icons/qileme-icon.svg` + 脚本 `scripts/generate-pwa-icons.mjs`（Playwright 渲染）**；测试 25 新增（tileCache 12 + fallback 改造 + db v3 + 设置页 2 + clearData 适配）；**已并入 PWA 提交** | 随本次提交推送 |
| ✅ 已提交 | **PWA 离线可用**（功能队列第 11 项） | `vite-plugin-pwa@1.3.0`（`registerType: autoUpdate`）：manifest（独立窗口/主题色 #0a4268/192+512+maskable 图标，start_url/scope 适配 `/cycling-analyzer/` 子路径）+ workbox（预缓存应用壳，`globIgnores: author-data/**` 排除快照，SPA `navigateFallback` + denyList 保护 author-data，cleanupOutdatedCaches）+ `main.tsx` `registerSW({immediate:true})` + `index.html` theme-color/apple-touch-icon + `vite-env.d.ts` 引用 vite-plugin-pwa/client；构建产物 `dist/sw.js` + `manifest.webmanifest` 已验证 | 随本次提交推送 |
| ✅ 已提交 | **移动端抽屉式侧边栏** | `AppLayout` 重构：顶栏汉堡按钮 + `aria-expanded` 遮罩滑轮菜单 + Escape/遮罩/导航点击关闭；`@media (max-width:768px)` 侧边栏 `position:fixed` 左滑入/出（`transform:translateX`）；顶栏品牌小 logo、导入弹窗移动端全屏优化；测试 4 新增（开合/导航/Escape/遮罩），全量 792/792 + lint/build 绿 | 随本次提交推送 |
| ⏳ 待办 | **功能队列（VIP 级，用户确认全做）** | 训练计划生成 ✅ / 表现趋势 ✅ / 每周训练综述 ✅ / 轨迹纠偏 ✅ / 自行车统计 ✅ / 离线地图 ✅ / PWA 离线可用 ✅ 已完成；剩余：目标设定与进度 / 比赛预测 / 路线规划器（画路线导出 GPX）/ 骑行记录 CSV 批量导出 | 每完成一个更新本行拆分为 ✅ 已提交 |
| 📌 待办 | 手动下载文件「机场东路有氧_平均心率138.fit」在 activities.csv 中无对应行 | 该活动无描述/估算功率（CSV 无匹配） | 用户可选：CSV 补行或改文件名，或保持现状 |
| ✅ 已提交 | 导入流程重构：批量导入数据源选择 + 单文件编辑弹窗 + 个人备注字段 | 同步面板新增「数据来源」下拉（Strava 解析 CSV / 佳明/igpsport/行者/其他按文件名还原）；选择单个 FIT 时弹「导入活动信息」框可编辑标题/说明/个人备注；`note` 新字段（模型/DB/仓库/详情页展示）；测试 636/636 + lint/build 绿 | push 触发 CI（随下次提交一起推送） |
| ✅ 已提交 | 导入面板 UI 优化 + 文件选择无反应 bug 修复 | 数据来源下拉改为两个目录导入入口按钮（Strava 导出 / 其他设备），单文件/拖拽导入无需来源（FIT 通用）；修复 FileList live 引用 bug——`event.target.value=''` 重置会清空已保存的 FileList，选择文件/目录回退后页面无反应；先 `Array.from` 转数组再重置，Playwright 实测弹窗→编辑→导入→落库全链路通过 | push 触发 CI（版本保持 1.8.0，本组为发布前完善） |
| ✅ 已提交 | 同步数据弹窗美化 | 按千问多模态读图审查 + Vercel Web Interface Guidelines 优化：弹窗内边距加大、入口卡片化（图标 + 主文案 + 说明，hover/active/focus 反馈）、拖拽区加上传图标与副文案、弹窗阴影/边框对比增强、淡入上滑动画 + prefers-reduced-motion 降级、overscroll-behavior: contain、关闭按钮 hover 态；千问回评 6.5→7.5+（布局/层次/间距获认可） | 推送待确认（版本保持 1.8.0） |
| ✅ 已提交 | 地图瓦片源自动降级（OSM → 高德 + GCJ-02 纠偏） | `src/map/tileSources.ts`（双瓦片源定义 + WGS-84→GCJ-02 标准算法，境内偏移/境外原样）；`src/map/FallbackTileLayer.tsx`（连续 3 次 tileerror 且期间无 tileload → 降级回调，单向防重）；详情页 ActivityMap 与热力图页接入（高德源时展示坐标统一转换，sessionStorage key `cycling-map-tile-fallback` 会话记忆）；测试 12 新增（tileSources 6 + fallbackTileLayer 6） | 已提交 `1b2c54b`，随 1.9.0 推送 |
| ✅ 已提交 | 品牌焕新：骑记 Ride Insight → 骑了么 + 新 Logo | 站名全量替换（index.html/404.html 标题、侧边栏品牌区删英文行 Ride Insight、README、分享卡落款/下载文件名）；新 Logo `public/qileme.png`（用户 AI 生成原图 2848×1600，去水印后压缩为 128×72，原图归档 `docs/brand/qileme-source.png`）接入侧边栏 + favicon；废弃 `ride.png` 删除；a11y 与 e2e 品牌断言同步 | 已提交 `c735121`，随 1.9.0 推送 |
| ✅ 已提交 | 品牌区视觉升级（Logo 放大 + 设计升级 + README 截图更新） | Logo 40 → 72px（`e84126d`）；品牌区设计升级（`f46de54`）：Logo 卡片化（圆角 10px + 边框 + 投影）、slogan 荧光绿左对齐、悬停微动效（prefers-reduced-motion 降级）；README 截图重截 8 页 + 截图脚本 HTTPS_PROXY 支持（`7819c0b`） | 已推送，随 1.10.0 发布 |
| ✅ 已提交 | 品牌定稿：通栏横幅图品牌区 + 新 Logo（2.0.0 大版本） | 新 Logo（自行车 + 数据图形，用户 AI 生成 1774×887 → 512×256 高清版，原图/矢量稿归档 `docs/brand/`）替换旧图标（`dcd9898`）；品牌区改为**通栏横幅图**（负 margin 抵消侧边栏内边距，图内自带品牌名，去 HTML 文字，`e2cc2f2`）；README 截图重截 8 页 + 截图脚本修复瓦片页 networkidle 超时（`113447f`）；版本 1.10.0 → **2.0.0**（成熟产品标记） | 随 2.0.0 发布 |
| ✅ 已完成 | 骑行路线图页（路线总览地图） | `/routes-map` 路由 + 侧边栏「路线图」导航：所有路线按聚类画在一张地图（`src/features/routes/routeMap.ts` 黄金角色相配色，同路线同色），点击路线列表高亮（其余降透明度）；作者源 CI 预计算 `precomputed/route-tracks.json`（buildAuthorData + snapshotClient `getRouteTracks`），本地源实时扫描（复用热力图缓存模式）；测试 11 新增 | 提交待确认 |
| ✅ 已完成 | 活动详情页「匹配的骑行」区块（Strava Similar Rides） | `src/features/routes/similarRides.ts`（`findMatchingRides`：同路线分组其他骑行，排除自身、时间降序）+ `src/features/activity/SimilarRidesSection.tsx`（详情页 SplitsSection 后挂载，展示名称/日期/距离/用时/速度，点击跳转；无匹配/失败不渲染）；作者源 `getRouteGroups` 预计算，本地源实时扫描（缓存模式）；测试 7 新增 | 提交待确认 |
| ✅ 已完成 | 路线图颜色优化 + 匹配骑行竞速 + 温度曲线 + 主题跟随系统 | 路线图：路线色亮度 60→42%（浅色瓦片醒目）+ 白描边光晕 + 选中加粗 6px、未选中透明度 0.06，地图铺满右侧（去 max-width）；匹配骑行加 `compareDurations` 竞速标签（比本次快绿/慢橙/持平）；详情页新增温度图表（`TemperatureChart`，MetricField 加 temperature，无数据不渲染）；设置页主题加「跟随系统」（Theme 加 'system'，matchMedia 解析 + change 监听自动跟随，显式主题卸载监听）；tests/setup.ts 补 matchMedia stub；测试 13 新增（竞速 4+组件 2、温度 5、主题 3 含 setup） | 提交待确认 |
| ✅ 已完成 | 爬坡分析（UCI 分级 + 可视化） | `climbs.ts`：buildClimbs（**噪声过滤**：距离 <2m / 海拔突跳 >80m / 坡度 >30% 点对跳过——修复真实数据出现 20%+ 虚假坡度）+ uciCategory（UCI 近似分级 HC/1-4，长度+平均坡度组合规则）；ClimbSection 可视化（**海拔剖面 SVG** 爬坡段级别色高亮 + 级别徽章卡片，去表格）；测试 11 新增 | 提交待确认 |
| ✅ 已提交 | **爬坡分析修复：大坡漏检 + 最陡坡度虚高**（用户反馈：HC 坡未识别 + 29.8% 坡度不合理） | 根因：设备海拔量化（±1m）+ 点距 3-5m 使单点对坡度天然超 30%，旧算法误判为噪声跳过 → 陡坡真实爬升被吞 90%（真实 23.66km/942m HC 坡漏检）、残余噪声点对让 maxGrade 虚高到 29.8%。修复：①不再按单点对坡度过滤，改 **80m 距离窗口平滑坡度**（窗口正增量累计÷窗口距离，稀疏数据退化为 5 点窗口）→ maxGrade 回到真实范围（HC 坡最陡 13.8%）；②gain 累计原始正增量（跳过海拔突跳 >30m 尖刺）；③**段内允许小幅下降**（累计下降 > 爬升 30% 且 10m 兜底才断段），大坡不再被小下坡拆碎；④**uciCategory 改用 Strava 官方公式**（support.strava.com：score = 长度米 × 平均坡度%，阈值 8k/16k/32k/64k/80k → 4/3/2/1/HC）——23.66km × 4% = 94,200 → **HC** ✓；测试适配新语义 + 新增密集点噪声回归用例；全量 701/701 + lint/build 绿，本地验证 4 段爬坡（3 级/2 级/HC/未分类） | 推送待确认（版本保持 1.8.0） |
| ⏳ 待办 | **功能队列（VIP 级，用户确认全做）** | 训练计划生成 / 目标设定与进度 / 表现趋势（12 周 + 效率因子）/ 比赛预测 / 离线地图（瓦片 IndexedDB 缓存）/ 路线规划器（画路线导出 GPX）/ 每周训练综述 / 骑行记录 CSV 批量导出 / 轨迹纠偏（GPS 漂移点清理）/ 自行车统计（FIT 提取单车字段）/ PWA 离线可用 | 每完成一个更新本行拆分为 ✅ 已提交 |

---

---

## 1. 已完成内容归档

全部已完成功能的详细清单已迁至 **`docs/archive/PROGRESS-archive-2026-08.md`**，
包括：阶段总览、按规格章节的已完成功能清单、P1/P2 阶段明细、作者数据快照、规格外延伸工作项（GPX 导出/赛段/热力图/年度回顾/性能优化等全部 ✅ 条目）。

需要查历史实现细节时再读归档文件；日常开发只需关注本文档的 §0 进行中任务、§2 未实现功能和 §3 架构约定。

---
## 5. 架构与接口约定（agent 工作须知）

### 模块边界（规格 §42，硬约束）

```
FIT Decoder → Normalizer → Calculator → Storage Repository → UI
```

- React 组件**禁止**直接调用 `@garmin/fitsdk`
- UI 只依赖 `src/types/activity.ts` 领域模型与 storage repository 接口
- 新增功能先定位到对应层，跨层直接调用视为违规
- **双数据源**：组件不直接 new 仓库，统一经 `useActivityRepository()` 按当前数据源（`dataSourceStore`）取本地 Dexie 仓库或作者快照仓库；作者源只读，写操作 UI 必须按源隐藏（规格外设计文档 §6.3）

### 测试约定

- Vitest + jsdom；DB 测试用 `fake-indexeddb`（tests/setup.ts 已全局注册）+ 真 Dexie 实例注入
- FIT 样例在 `tests/fixtures/`（Garmin 官方公开样例 + 合成带 GPS 文件，`generate-samples.mjs` 可复现）
- 用户真实数据在 `private-fixtures/`（**gitignored，严禁提交**）
- 关键规则：纯函数优先可测；组件渲染测试用 MemoryRouter 包裹；页面数据加载支持注入

### 代码规范（全局 CLAUDE.md）

- 注释中文；日志/异常消息英文；React 组件 `function` 声明；`@/` 别名导入
- 提交信息 `[NF]`/`[BF]`/`[IM]`/`[CU]` 前缀 + 中文 Subject；**无 AI 署名**
- 提交身份固定为 `999bug <999bug@users.noreply.github.com>`（项目级 git config 已设，勿改）
- 完成后执行 `codegraph sync`

### 常用命令

```bash
npm run dev        # 本地开发
npm run test       # 测试（vitest run）
npm run test:e2e   # E2E（Playwright，首次需 npx playwright install chromium）
npm run lint       # ESLint
npm run build      # tsc + vite build
node tests/fixtures/generate-samples.mjs   # 重新生成合成 FIT 样例
```

---

## 6. UI 体验改造任务队列（2026-08-21 评审立项）

> **背景**：用户提供外部评审《骑了么_网站改造评审 2026-08-20》（md 版 `E:\downloads\骑了么_网站改造评审.md`），
> 结合线上站 8 页截图实测（`scripts/capture-screenshots.mjs`）交叉判断后立项。当前优化方向锁定 **UI/体验**。
>
> **核心结论**（评审原话）：功能丰富度已足够，下一阶段 KPI 不是"新增多少功能"，
> 而是"用户打开一次活动后，能否更快理解这次骑行"。
>
> **工作方式**：本节为跨会话工作队列——每开始一项先在 §0 登记，完成后更新 §6.2 状态表；
> 每个 P0 级任务单独 commit；技术约束见 §6.4。

### 6.1 评审项与现状对照（2026-08-21 核实，避免重复劳动）

| 评审项 | 状态 | 现状说明 |
|---|---|---|
| P0-03 图表/地图统一游标 | ✅ **已完成，勿重做** | 2026-08 提交 `9250ae5`：`src/charts/timeline.ts` + 六图/地图/爬坡剖面共享 `hoverTimestamp`/`onHover` 联动，参考线 + 地图圆点同步 |
| P0-04 Design Token | ⚠️ 半成品 | `index.css` 已有 `--bg/--bg-surface/--text/--text-secondary/--primary/--on-primary/--border`；**缺语义色**（成功/警告/异常/info）、间距/圆角/阴影 token 分散在各组件 CSS 硬编码；图表调色板未与品牌色体系对齐 |
| P0-01 详情页报告化 | ❌ 真问题 | `ActivityDetailPage.tsx` 顺序：标题→12 指标卡→质量评分→成就→地图→7 图表→splits→分段→相似→对比→训练效果→区间。**无一句话总结、无洞察区**，首屏是"数据墙" |
| P0-02 动态骑行洞察 | ❌ 真问题 | 已有 `climbInsights`/`qualityScore`/`segments` 洞察均为结构化数据，**无自然语言洞察层**（评审要求 3~5 条真实数据驱动文案，严禁写死） |
| P0-05 移动端 | ⚠️ 部分 | `AppLayout` 抽屉侧边栏已完成；日历页 375px 下大量留白、详情页指标卡/图表未做窄屏适配、hover 交互无 touch 方案待核 |
| P1 隐私可信度 | ⚠️ 藏在 README | "本地解析、不上传"未进首屏/导入页文案；数据存储位置说明、清空数据影响提示待补 |
| P1 四态补齐 | ⚠️ 部分 | 详情页有 loading/notFound/error 三态；作者源空态、导入失败详情态不完整 |

### 6.2 任务队列（按优先级排序，跨会话推进）

> 优先级依据「用户感知价值 ÷ 改造成本」排序。每个任务完成时把 ⏳ 改 ✅ 并附 commit 号。

| 编号 | 任务 | 优先级 | 状态 | 内容与验收标准 | 预计规模 |
|---|---|---|---|---|---|
| UI-1 | **动态骑行洞察（P0-02）** | ⭐ 最高 | ✅ 已实现 | `src/features/insights/rideInsights.ts` 纯函数（输入 `Activity + Record[]`，输出 `Insight[]`）+ `RideInsightsSection` 组件挂详情页（质量评分后、地图前）。已实现 8 类洞察：后半程衰减（前 30% vs 后 30% 速度/功率）、爬升占比/爬坡日、心率漂移、心率-功率耦合、配速波动、长距离、强度档位（IF）、GPS 漂移数——全部真实数据条件生成，不足 3 条用概览兜底；无写死示例文案。测试 19 新增（rideInsights 12 + section 7） | ~330 行 + 19 测试 |
| UI-2 | **详情页报告化（P0-01）** | ⭐ 高 | ✅ 已实现 | 新增 `rideSummary.ts` 纯函数 `buildRideSummary`：骑行类型推断（长距离/爬坡/恢复骑/耐力骑/节奏骑/高强度/长骑行/骑行）+ 质量档位短语 + 数据驱动总结文案；新增 `RideSummaryBanner` 组件挂详情页顶部（标题下、指标前）；核心指标精选 4 固定（距离/运动时长/爬升/平均速度）+ 至多 2 动态（标准化功率/平均功率/平均心率/平均踏频，缺失值 '—' 不入选），其余指标折叠为「更多指标」`<details>`。验收：5 秒内回答"骑多久、多少公里、骑得怎么样"。测试 14 新增（rideSummary 10 + banner 4），全量 830/830 + lint/build 绿 | ~280 行 + 14 测试 |
| UI-3 | **Design Token 体系化（P0-04）** | 高 | ✅ 已实现 | `index.css` 扩充语义 token：`--success/--warning/--danger/--info`（含 on-* 前景与深浅双主题）、`--bg-elevated/--text-tertiary`、`--space-*/--radius-*/--shadow-*`；新增 `src/theme/colors.ts` 统一图表调色板（ZONE_COLORS/TRAINING_LINE_COLORS/PERFORMANCE_SERIES_COLORS/SEGMENT_BAND_COLORS/COMPARE_COLORS），详情页/训练状态/表现趋势/分段/对比 5 处 TS 硬编码色改引用；9 个 CSS 文件硬编码色改 `var(--token)`（含 `color-mix` 替代 rgba）；作者模式横幅改 info 中性配色（弱化警告感）。验收：深浅主题下语义色一致 | 1 commit |
| UI-4 | **移动端重构（P0-05）** | 中高（依赖 UI-2/3） | ✅ 已实现 | 详情页新增 ≤480px 断点：标题区纵向堆叠 + 操作按钮组换行 + meta 换行 + 标题缩字号 + 总结条质量短语全宽（指标卡 2 列由既有 auto-fit 覆盖）；日历页新增**年度汇总统计卡**（`buildYearSummary` 纯函数：骑行天数/次数/总距离/总时长/总爬升/最长单日 6 卡，填充热力图下方留白，桌面/移动双受益）。既有断点复核：768px 抽屉/16px 边距、600px 卡片堆叠、760px 图表单列均已就位。测试 3 新增（buildYearSummary 2 + CalendarPage 年度卡 1），全量 833/833 + lint/build 绿 | 1 commit |
| UI-5 | **隐私可信度（P1）** | 中 | ✅ 已实现 | 导入弹窗首屏加「文件在本浏览器内解析，不会上传到任何服务器」提示（info 中性配色 + 盾牌图标）；仪表盘空态（首次访客）加隐私文案；设置页数据管理区补「数据存哪/清空浏览器数据会怎样」说明与备份建议；清空全部数据确认文案补影响范围（删除活动/赛段/训练配置，不含作者数据）。作者模式提示条配色已在 UI-3 改中性 info 色。测试同步更新，全量 833/833 + lint/build 绿 | 1 commit，纯文案+样式 |
| UI-6 | **杂项修复** | 中 | ✅ 已实现 | §6.3 遗留问题清理：①统计卡「最高功率 0 W」→ `—`（`StatisticsMetrics.maxPower` 改 `number \| undefined`，聚合仅活动有功率时比较，规格 §25 违例修复）；②仪表盘新增「最近骑行」区块（`buildDashboardData.recentActivities` 最近 5 条 + `RecentRidesSection` 卡片列表，填下半屏留白，§6.3 问题 4）；③日历可点击格子 hover 主题色描边 + 轻微放大 + tooltip 追加「（点击查看当日骑行）」（§6.3 问题 5）；④§6.3 问题 7 侧边栏 logo 已有通栏横幅 + 边框阴影 + hover 微动效，无需再改。测试 4 新增（statistics 2 + DashboardPage 1 + 纯函数 1），全量 838/838 + lint/build 绿 | 1 commit |
| UI-7 | 高级指标 tooltip | 中 | ✅ 已实现 | 新增可复用组件 `src/components/MetricHelp.tsx`（原生 `<details>` 折叠 + `MetricHelpItem[]` 条目，深浅主题 token 化样式）：①仪表盘训练状态区块图例下补 6 条（CTL=42 天 EWMA/ATL=7 天 EWMA/TSB=CTL−ATL 正负解读/TSS 公式/NP 30 秒滑动四次方/IF=NP÷FTP）；②表现趋势页图表下补 4 条（EF=Σ(NP×时长)÷Σ(心率×时长)/TSS/NP/4 周移动平均）；③设置页 FTP/VO2Max 估算与详情页区间说明已有 inline 文案，无需重复。测试：TrainingStatusSection 同名文本断言改 getAllByText/findAllByText + 新增说明断言，PerformancePage 新增 EF 说明断言 | 小，1 commit |
| UI-8 | 统计页叙事化（P1 页面结构建议） | 低（收益大但改动大） | ✅ 已实现 | 统计页按三个用户问题分章重排：①「我进步了吗？」= 范围指标卡 + 个人纪录；②「我骑什么路线？」= 路线分析；③「我用什么设备？」= 设备统计 + 自行车统计。每章一句导语（`statistics-chapter` 样式，语义 token）；五个子组件标题 h2 → h3（类名样式不变），章节标题升为 h2；区块顺序从「指标/纪录/设备/自行车/路线」调整为「进步/路线/设备」。子区块 aria-label 不变，既有测试零破坏；新增分章顺序断言用例，全量 839/839 + lint/build 绿 | 1 commit |

### 6.3 截图实测发现的问题（2026-08-21，评审外补充）

1. **详情页打开 = 12 指标卡铺面**：地图在折叠线以下，无结论性内容（并入 UI-2）
2. **质量评分 89 分被埋在指标卡与地图之间**：最有价值的"一句话结论"位置太靠后（并入 UI-2）
3. **统计页后台 Dashboard 气质**：10 指标 + 7 纪录全是 4 卡/行平铺，无叙事结构；设备/自行车统计两行近空白（并入 UI-8）
4. **仪表盘下半屏 ~30% 留白**：缺"最近活动"卡片或引导入口（可并入 UI-2 或单独做）
5. **日历页右半屏大量留白**：格子可点击展开但无任何可点击暗示（并入 UI-4）
6. **统计页功率纪录显示「0 W」**：作者源无功率数据时应显示 `—` 而非 0（**规格 §25 违例**，查 `personalRecords.ts`/`RecordCards.tsx` 退化路径，应属 UI-6 bug 修复）
7. **侧边栏 logo 小、视觉锚点弱**（品牌区已是 Link，但识别度低，可并入 UI-3）
8. **作者模式提示条配色偏警告感**（并入 UI-5）

### 6.4 技术约束（评审 §11 原则 + 本项目补充）

- 优先复用现有 FIT 数据模型、stores、charts、map、features，**不为 UI 改造大面积重写数据层**
- 新分析逻辑（洞察/骑行类型推断）写成**纯函数**：输入 Activity/Record[]，输出结构化结果，Vitest 单测
- UI 组件不重复计算 NP/TSS/区间等指标（复用 `features/analysis/*` 现有实现，避免多实现漂移）
- 所有新功能覆盖"有数据/数据缺失/空活动/解析失败/大数据量"场景；**缺失字段显示 `—` 不伪造**（规格 §25）
- 每个任务单独 commit（前缀 `[NF]`/`[IM]` + 中文 Subject），改前先在 §0 登记、改后更新本节状态表
- 完成后全绿：`npm run lint && npm run test && npm run build`；涉及主链路补 E2E；push 前升 minor 版本

