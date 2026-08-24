# 项目进度与功能状态

> 本文档记录骑行数据分析网站（cycling-analyzer）的功能实现状态、架构边界与接口约定，
> 供后续开发（含 AI agent）继续工作参考。最后更新：2026-08-24（赛段排行榜 UI 增强 + 有氧效率趋势，见 §0）。
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

## 1. 阶段总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | 项目初始化（Vite/React/TS/ESLint/Prettier/Vitest/路由/Layout） | ✅ 完成 |
| Phase 2 | FIT Parser（Decoder/Normalizer/Calculator/Fingerprint/Strava CSV） | ✅ 完成 |
| Phase 3 | IndexedDB 存储层（Dexie 四表 + Repository） | ✅ 完成 |
| Phase 4 | FIT 导入流程（目录扫描/gzip/去重/Worker/进度/失败重试） | ✅ 完成 |
| Phase 5 | Activity List（列表/排序/搜索/筛选/分页） | ✅ 完成 |
| Phase 6 | Activity Detail（地图/图表/删除） | ✅ 完成 |
| Phase 7 | Dashboard（周/月/总计 + 趋势图） | ✅ 完成 |
| Phase 8 | GitHub Pages 部署（Actions + SPA 路由） | ✅ 完成 |
| P1 阶段 | 规格 §38 高级功能 | ✅ 完成（见 §3） |
| P2 阶段 | 规格 §39 高级功能 | ✅ 完成（见 §3.1） |
| 作者数据快照 | 数据源抽象 + CI 构建时快照 + 数据源切换 + 作者数据只读 | ✅ 完成（见 §3.2） |

- 验证：**631/631 测试通过**，lint/build 全绿；线上 https://999bug.github.io/cycling-analyzer/ 可用
- 端到端已实测：真实 Strava 导出 .fit.gz 拖拽导入 → Dashboard 自动刷新 → 列表 → 详情地图/图表 → 刷新持久化

---

## 2. 已完成功能清单（按规格章节）

### 核心链路（规格 §5/§8/§42）

| 能力 | 位置 | 说明 |
|---|---|---|
| FIT 识别/CRC 校验 | `src/fit/decoder/fitDecoder.ts` | `isFitFile` / `checkFitIntegrity` / `decodeFit`；非 FIT 与损坏抛 `NotFitFileError` / `CorruptedFitError`；**Stream 必须 read 前校验** |
| FIT 消息提取 | 同上 | recordMesgs/sessionMesgs/lapMesgs/activityMesgs → 领域中间结构（时间转 Unix 秒，位置保留半周） |
| 标准化 | `src/fit/normalizer/normalizer.ts` | `normalizeActivity(fit, { id, fileName, fingerprint })`；半周→十进制度、Date→ISO、缺失字段 undefined |
| 统计计算 | `src/fit/calculator/calculator.ts` | `calculateSummary(records, session?)`；距离取末点累计、爬升=相邻正增量、平均速度=距离/时长；缺失 ≠ 0 |
| 指纹 | `src/utils/fingerprint.ts` | `computeFingerprint(bytes)` SHA-256，去重依据（**基于解压后内容**） |
| Strava 标题还原 | `src/features/import/stravaExport.ts` | `parseStravaActivitiesCsv`（跨行引号/BOM 兼容），按文件名匹配；**CSV 未命中时文件名兜底提取标题**（`titleFromFileName`：Strava 手动下载文件名=标题，纯数字 ID 文件名跳过不显示数字标题）；**描述与估算功率**（`buildStravaMetaLookup`/`matchStravaMeta`/`applyStravaMeta`：活动描述落库详情页展示；FIT 无功率计时用 CSV「平均瓦特数/最大瓦特数/加权平均功率」填充 avgPower/maxPower/normalizedPower，实测功率不覆盖） |

### 导入（规格 §6/§7/§9/§21/§22/§23/§24）

| 能力 | 位置 | 说明 |
|---|---|---|
| 三入口 | `src/features/import/ImportPanel.tsx` | 目录（showDirectoryPicker）/ 文件（webkitdirectory 回退）/ 拖拽；挂在 AppLayout 侧边栏底部 |
| 扫描 | `scanner.ts` | 递归 `*.fit` 与 `*.fit.gz`（Strava 导出 gzip） |
| gzip | `gzip.ts` | fflate 解压（jsdom/浏览器双环境一致） |
| 导入执行 | `importer.ts` | `importFiles(files, options)` → 解压→指纹→去重→worker 解析→标题还原→入库；返回 { total, newImported, skipped, failed, failedItems } |
| Worker | `src/fit/worker/parseWorker.ts` + `parseClient.ts` | 每批一个 worker，jsdom 自动降级主线程 |
| 进度/失败 | `src/stores/importStore.ts`（zustand） | 进度条、失败台账（fileName+原因）、重试失败文件 |

### 存储（规格 §18/§45）

| 能力 | 位置 | 说明 |
|---|---|---|
| Dexie 库 `cycling-data` v2 | `src/storage/db.ts` | 五表：activities（&fingerprint 唯一索引）、activity_records（++id, activityId）、files（主键 fingerprint）、settings（key/value）、segments（v2 新增，++id 自增）；**摘要与逐点分表** |
| 活动仓库 | `src/storage/repositories/activityRepository.ts` | `addActivity/addActivities/getById/getRecords/listActivities/countActivities/existsByFingerprint/updateName/updateNormalizedPower/deleteActivity/deleteAll/summarizeByRange/listAllSummaries`；listActivities 支持 sortBy(startTime/distance/duration)/month('2026-08')/activityType/search/offset/limit |
| 文件台账 | `fileRepository.ts` | recordImported/recordFailed/listAll/get/deleteAll |
| 设置 | `settingsRepository.ts` | get/set/delete（key/value unknown） |
| 赛段 | `segmentRepository.ts` | addSegment/listSegments/deleteSegment（v2 表） |
| 数据源分发 | `src/storage/sourceActivityRepository.ts` + `src/hooks/useActivityRepository.ts` | `getActivityRepository(source)` 按源返回本地 Dexie 仓库或作者快照仓库（模块级单例，源切换引用变化驱动各页面 effect 重载）；组件统一经 `useActivityRepository()` 获取 |

### 页面（规格 §13/§14/§15/§16/§17）

| 页面 | 路由 | 能力 |
|---|---|---|
| Dashboard | `/` | 本周/本月/总计（次数/距离/时长/爬升）+ 30/90/365 天趋势图；**订阅 importStore 导入后自动刷新** |
| Activity List | `/activities` | 排序/搜索/月份+类型筛选/分页 20/页；缺失字段 `—`；行点击跳详情 |
| Activity Detail | `/activities/:id` | 10 指标卡（距离/运动时长/总时长/爬升/累计下降/平均速度/平均心率/平均功率/平均踏频/卡路里，功率活动追加标准化功率卡）+ Leaflet 轨迹（Douglas-Peucker 抽稀 + 起点绿点/终点黑白格旗标 + fitBounds + 滚轮缩放 + 全屏查看）+ 7 图表（速度/心率/踏频/海拔/功率/功率曲线/速度+心率组合，Tooltip/Brush/时间-距离轴）+ 删除（二次确认+级联） |
| Statistics / Calendar / Settings | `/statistics` `/calendar` `/settings` | ✅ P1 完成（见 §3）；统计页含「个人纪录」「设备统计」「路线分析」区块（P2，见 §3.1） |
| Heatmap 热力图 | `/heatmap` | ✅ P2 完成（见 §3.1：全部轨迹低透明度叠加） |
| Year Review 年度回顾 | `/year-review` | ✅ 后续项完成（见 §4：年份切换 + 年度指标 + 月度距离图） |
| Segments 赛段 | `/segments` | ✅ 后续项完成（见 §4：起终点圆穿越匹配 + 成绩榜） |

### 地图（瓦片源自动降级，2026-08-19 新增）

| 能力 | 位置 | 说明 |
|---|---|---|
| 瓦片源自动降级 | `src/map/tileSources.ts` + `src/map/FallbackTileLayer.tsx` | 默认 OSM，国内直连失败（**连续 3 张瓦片失败且期间无成功**，tileload 重置计数）自动降级高德瓦片（`webrd0{s}.is.autonavi.com`，国内直连可用）；降级单向防重 + **sessionStorage 记忆**（key `cycling-map-tile-fallback`，本会话内刷新页面直接走高德不再重试 OSM）；详情页 `ActivityMap` 与热力图页 `HeatmapPage` 共用 |
| GCJ-02 坐标纠偏 | `src/map/tileSources.ts` `wgs84ToGcj02` | 高德底图为火星坐标，WGS-84 轨迹直接叠加偏移 300-500 米；降级后所有展示坐标（Polyline/起终点/fitBounds/热力轨迹）统一转换对齐；标准加密算法，**中国境外坐标原样返回**；测试参考值用在线工具成对数据验证（3 位小数 ≈ 50 米精度） |

### 部署（规格 §34/§35）

- `.github/workflows/deploy.yml`：push main → lint → test → **build:author-data（作者数据快照）** → build → deploy-pages（Node 22）
- SPA 路由：`public/404.html`（rafgraph 方案）+ main.tsx `basename={import.meta.env.PROD ? '/cycling-analyzer' : '/'}`
- vite.config：`base` 按环境区分——build 时绝对路径 `/cycling-analyzer/`、dev 时 `/`（**必须绝对路径**：404.html 的 replaceState 会先把 URL 还原成深链，相对 base `./` 会让 `./assets` 在二级以上路由解析到错误目录导致白屏，v1.4.1 修复）；`@/` → src/ 别名，vitest jsdom + setupFiles

---

## 3. P1 阶段（规格 §38）已完成

### 已完成

| 功能 | 状态 | 文件与说明 |
|---|---|---|
| Statistics 统计页（§28） | ✅ Agent G，29/29 测试 | `src/features/statistics/`（statistics.ts 聚合 + RangeSelector + StatisticCards）；`resolveRange`/`buildStatistics` 可注入 now；范围：本周/本月/今年/12 个月/全部/自定义 |
| 轨迹颜色分析（§16 着色） | ✅ Agent J，32/32 测试 + 图例 6/6 | `src/map/routeColoring.ts`（`buildSegments`/`buildBucketLines`/`getColorForValue`）；ActivityMap 新增 `coloring` prop（'none'\|'speed'\|'heartRate'\|'power'\|'altitude'，默认 none 向后兼容）；>500 段自动 8 桶合并；**`ColoringLegend.tsx` 图例：开启着色时显示 jetRamp 同源渐变条（COLORING_LEGEND_GRADIENT 采样生成防漂移）+ 值域端点（速度随单位偏好 km/h/mph，海拔数据 min-max，其余固定物理域），指标全缺失不渲染** |
| 踏频/组合图组件（§17） | ✅ Agent K，24/24 测试 | `src/charts/CadenceChart.tsx`（rpm）；`CombinedChart.tsx`（mode: 'speedHeartRate'\|'powerHeartRate'，双 Y 轴 + 降级）；`buildCombinedSeries` 以首条有效记录为对齐基准；**未挂载详情页**（待 Agent L） |
| Calendar 日历页（§29） | ✅ Agent H，24/24 测试 | `src/features/calendar/`（calendarData 聚合 + CalendarHeatmap）；**GitHub 贡献图横排布局（每周一列/每天一行）+ 月份标签（buildMonthLabels 定位每月 1 日所在列）+ 隔行星期标签 + 今天高亮 + 「回到今年」**；5 档距离色阶（20/50/100km 阈值）、tooltip（次数/距离/时长/爬升）、年份切换、订阅 importStore 自动刷新；**点击有骑行格子展开当日活动面板（活动列表跳详情）** |
| Settings 设置页 + 导出/导入/清空（§27/§32/§33） | ✅ Agent I，34/34 测试 | `src/features/settings/`（settings.ts/exportImport.ts/dataClear.ts）；**key 规范：`'profile'`（UserProfile 对象）+ `'units'`（UnitPreferences），按域合并保存，数据恒存公制**；导出 JSON v1（app/version/activities/records/files/settings），导入按 fingerprint 去重 |
| 高级数值筛选（§30） | ✅ Agent M，64/64 测试（含 6 新增） | `listActivities` options 新增 min/maxDistance（米）、min/maxElevationGain（米）、min/maxAvgPower（W），AND 组合含边界；**缺失 avgPower 的活动不满足功率条件**；UI 输入 km 自动转米 |
| 有氧效率月度趋势（无功率计场景） | ✅ 4/4 测试 | `src/features/analysis/aerobicEfficiency.ts`：`buildMonthlyAerobicEfficiency` AE = Σ(平均速度×时长) ÷ Σ(平均心率×时长)，按自然月聚合连续 N 月序列（空月 undefined）；`PerformancePage.tsx` 「有氧效率趋势」区块（12 月折线 + 4 月移动平均，无心率数据整块隐藏） |
| 训练分析 + 详情页集成（§26） | ✅ Agent L，41/41 测试 | `src/features/analysis/`（normalizedPower.ts NP 30s 滑动平均 4 次方、intensity.ts IF/TSS、zones.ts 心率 60/70/80/90% + 功率 55/75/90/105% 5 区间，按记录时间间隔累计）；ActivityDetailPage：标准化功率卡 + 踏频图/速度+心率组合图挂载 + 轨迹着色切换（默认/速度/心率/功率/海拔）+ 训练区间区块（**心率统计行——平均/最大/最小心率（最小心率逐点计算，缺失 —）+ 心率折线图（自图表区移入，x 轴时间/距离可切换）** + 区间分布条 + IF/TSS）；**无 FTP/最大心率配置不伪造计算，显示引导文案**；**区间区块附「计算方式说明」折叠块**（原生 details：心率按最大心率 60/70/80/90%、功率按 FTP 55/75/90/105%、NP=30s 滑动平均四次方均值开四次方、IF=NP÷FTP、TSS=时长×IF²×100÷3600） |

### 进行中

P1 阶段任务已全部完成，无进行中项。

---

## 3.1 P2 阶段（规格 §39）已完成

### 已完成

| 功能 | 状态 | 文件与说明 |
|---|---|---|
| 功率曲线（详情页） | ✅ 12/12 测试 | `src/features/analysis/powerCurve.ts`：能量积分法（p·Δt 前缀和 + 双指针），Δt 钳制 5s 防断档虚计，标准 11 档时长（1s~1h），跨度不足时长无点；`src/charts/PowerCurveChart.tsx`：对数时长轴 LineChart，挂详情页图表区 |
| 个人纪录（统计页区块） | ✅ 13/13 测试 | `src/features/records/personalRecords.ts`：`buildRideRecords`（最远距离/最长时长/最多爬升，并列保留最早）+ `buildPowerRecords`（合并全活动功率曲线取各时长最佳，5s/1min/5min/20min 四档）；`RecordCards.tsx` 卡片墙（值+日期+详情链接）；统计页底部挂载，全时段口径与范围选择无关，功率纪录异步全量扫描（计算中/失败/无功率数据三态提示） |
| 训练状态 Fitness/Fatigue（§39） | ✅ 18/18 测试 | `src/features/analysis/trainingStatus.ts`：每日 TSS 聚合 + CTL 42 天/ATL 7 天 EWMA + TSB 前一日口径；**导入时同步算 NP 落库**（importer.ts，摘要含 normalizedPower），历史活动 `backfillNormalizedPower.ts` 幂等回填（repository 新增 `updateNormalizedPower`）；`TrainingStatusSection`（Dashboard：当前值卡 + 90 天三线趋势；无 FTP/无功率引导文案） |
| 设备统计（§39） | ✅ 6/6 测试 | `src/features/statistics/deviceStats.ts`：按设备分组聚合（次数/距离/时长/爬升/最近骑行，显示名产品名→型号→制造商回退，缺失归「未知设备」）；`DeviceStatsCards` 统计页底部区块（全时段口径）；自行车无独立数据源（FIT 未提取单车字段），设备统计即设备/码表维度 |
| FTP 自动估算 / VO2Max 估算（§39） | ✅ 10/10 测试 | `src/features/analysis/ftpEstimate.ts`：FTP = 近 90 天 20 分钟最佳功率 × 0.95（取整），VO2Max = 10.8 × 5 分钟最佳功率 ÷ 体重 + 7（1 位小数），非法输入 undefined；设置页 FTP 字段下方估算区块（异步扫描近 90 天含功率活动，`buildPowerCurve(records, [300, 1200])` 跨活动取最佳），「采用」按钮一键保存 FTP；无功率数据/未填体重显示引导文案（不伪造）；`Activity` 领域模型补 `name` 字段（§31，修复详情页改名提交的 tsc 遗漏） |
| 骑行热力图（§39） | ✅ 5/5 测试 | `src/pages/HeatmapPage.tsx`（/heatmap 路由 + 侧边导航「热力图」）：全部活动轨迹 `simplifyRoute` 10m 抽稀后 **紫色 `#9333ea`、宽 3px、透明度 0.45** Polyline 叠加（浅色瓦片底图高对比，与详情页轨迹主蓝 `#4f8cff` 明显区分；瓦片源自动降级见 §2 地图小节），重合路段自然加深形成热力；无坐标活动自动剔除，fitBounds 全轨迹视野；加载/空态/错误三态文案 |
| 单位换算显示（§27） | ✅ 7/7 新增测试 | settings.ts 新增 `formatSpeedByUnit`（km/h ↔ mph 随距离单位）；新 hook `src/hooks/useUnits.ts`（挂载读一次单位偏好，默认公制）；StatCards/TrendChart/ActivityListTable/StatisticCards/RecordCards/DeviceStatsCards/CalendarHeatmap 加 `distanceUnit` prop（默认 'km' 向后兼容），详情页复用已加载 settings（距离/速度 mi + 开始时间 12h '3:30 PM'）；四个页面接入 useUnits |
| 路线分析（§39） | ✅ 13/13 测试 | `src/features/routes/routeGrouping.ts`：贪心聚类（起点 500m 内 + 终点 500m 内 + 距离 ±10% 组均值容差，haversine 测距），输出按次数降序/最近骑行降序；端点提取 `extractEndpoints`（统计页合并扫描复用已加载 records）；`RouteGroupCards.tsx` 统计页底部区块（路线卡片以**最近骑行标题**命名——无标题回退「路线 N」，长标题 CSS 缩略 + title 悬浮看全名；次数/平均距离/最快用时/最近骑行，点击跳最近详情）；完整 Segment 已完成（见 §4 后续工作项） |

---

## 3.2 作者数据快照（规格外：作者数据公开发布）已完成

> 设计文档：`docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md`；计划：`docs/superpowers/plans/2026-08-18-author-data-snapshot.md`

站点默认展示作者 Saul 公开发布的骑行数据（只读），访客可切回「我的数据」导入自己的 FIT（数据仍仅存其浏览器 IndexedDB，两源完全隔离）。

| 能力 | 位置 | 说明 |
|---|---|---|
| 快照构建脚本 | `scripts/buildAuthorData.ts`（`npm run build:author-data`，tsx） | 解析 `author-data/fit/` 下 `.fit`/`.fit.gz` → 输出 `public/author-data/`：manifest.json / activities.json / records/\<id\>.json / profile.json / segments.json + **预计算** precomputed/{tracks,segment-results,route-groups,power-records}.json（跨活动全量扫描类功能免访客端逐点下载）；产物 gitignored，CI 重建 |
| 快照客户端 | `src/storage/snapshot/snapshotClient.ts` | `SnapshotClient` 接口 9 方法 + `createSnapshotClient`（Map 缓存 + fetch `${BASE_URL}author-data/...`）+ `defaultSnapshotClient` 单例；404/失败优雅回退 |
| 作者仓库 | `src/storage/repositories/authorActivityRepository.ts` | `AuthorActivityRepository` 实现只读接口，数据来自快照客户端 |
| 数据源状态 | `src/stores/dataSourceStore.ts` | `source`（persist key `cycling-data-source`，partialize 仅 source）/ `authorAvailable`（initDataSource 探测 manifest 翻牌）/ `authorName`；`selectEffectiveSource` 作者不可用时回退 local |
| 切换器 + 提示条 | `src/components/DataSourceSwitcher.tsx` / `AuthorBanner.tsx` | 侧栏分段控件（作者档带「作者」徽章，未发布时禁用）；作者模式下页面顶部只读提示条（可关闭，localStorage 记忆） |
| 训练配置随源 | `src/features/settings/effectiveProfile.ts` | `getEffectiveProfile(source)`：作者源读快照 profile.json（失败回退 {}），本地源读 settings.profile；详情页/训练状态接入 |
| 只读约束 | 详情页/赛段页/设置页 | 作者模式隐藏重命名、删除、设为赛段、赛段删除等写操作（GPX 导出保留）；设置页导出/清空仅作用于「我的数据」并有文案说明 |
| 导入联动 | `src/stores/importStore.ts` | 导入完成有新活动（`newImported > 0`）时自动切回「我的数据」 |
| CI 接入 | `.github/workflows/deploy.yml` | Test 与 Build 之间插入 `Build author data` 步骤，快照随 dist 发布 |

**作者更新数据流程**：向 `author-data/fit/` 提交 `.fit`/`.fit.gz`（可选同步 `activities.csv` 还原 Strava 标题、填写 `author-data/profile.json` 的 FTP/最大心率/体重以启用作者模式训练状态与区间分析），push 后 CI 自动重建快照。

---

## 4. 未实现功能（后续工作项）

### P1 剩余（规格 §38）

- [x] FTP / 心率区间 / 功率区间分布展示 + NP/IF/TSS + 着色切换 UI（详情页，Agent L ✅）

### P2（规格 §39，已全部完成）

- [x] Segment / 路线分析（✅ 见 §3.1：起终点 500m + 距离 ±10% 贪心聚类，统计页路线卡片；完整 Segment 逐点匹配为后续工作项）
- [x] 个人纪录（PR）（✅ 见 §3.1：骑行纪录 3 项 + 功率纪录 4 档，统计页区块）
- [x] 功率曲线（✅ 见 §3.1：详情页 PowerCurveChart，11 档标准时长）
- [x] FTP 自动估算 / VO2Max 估算（✅ 见 §3.1：设置页估算区块 + 采用按钮）
- [x] Fitness / Fatigue（训练状态）（✅ 见 §3.1：Dashboard TrainingStatusSection）
- [x] 骑行区域统计 / 热力图（✅ 见 §3.1：/heatmap 页面低透明度轨迹叠加；骑行区域统计见后续工作项）
- [x] 设备统计 / 自行车统计（✅ 见 §3.1：统计页设备统计区块；自行车无数据源）

### 其他未实现（规格内遗漏项）

- [x] **修改活动名称 UI**（§31）：✅ 详情页标题区内联改名（重命名→输入→保存/取消，Enter 保存/Esc 取消，空名恢复「日期 骑行」兜底名）
- [x] **保存原始 FIT 文件开关**（§19）：✅ FileEntity 加非索引 `data?: ArrayBuffer`（Dexie 非索引字段免升版本）；设置新增 import 域（`saveOriginalFit` 默认 false）；importStore 导入前读偏好 → importer 落库解压后字节；设置页「导入」区块开关即存；导出 JSON 剥离 data 字段
- [x] **浅色主题**（§36）：✅ `:root[data-theme='light']` 变量覆盖 + 设置页「外观」区块切换即存；设置新增 appearance 域（`theme: dark|light`，默认深色）；`theme.ts`（applyTheme/initTheme/switchTheme），main.tsx 启动恢复，清空数据复位深色
- [x] **单位换算显示**（§27 公里/英里、12h/24h）：✅ 已接入显示层（见 §3.1：useUnits hook + 各卡片/表格/图表 distanceUnit prop，详情页 12h 时间）
- [x] **性能压测**（§44）：✅ `tests/perf/scale.test.ts` 6 例——1000 活动 × 100 逐点灌库（10 万行），分页/筛选查询 <1s，Dashboard/日历/设备聚合纯函数 <1s，单 FIT 解析 <3s，5 万点功率曲线/轨迹抽稀 <2s（宽松上限防量级回归，非精确基准）
- [x] **README 完善**（§46）：✅ 功能清单已补齐（新页面/训练分析/数据管理/E2E 命令），截图等未补

### P2 之后的后续工作项（规格外延伸，逐项推进）

- [x] **导出 GPX**（✅ 7/7 测试）：`src/features/activity/gpxExport.ts`（GPX 1.1 构造：trkpt 7 位坐标 + ele + time，XML 转义，无坐标返回 undefined 不伪造；文件名去 .fit/.fit.gz 后缀）；详情页标题区「导出 GPX」按钮（无轨迹坐标禁用），Blob 下载
- [x] **完整 Segment 赛段**（✅ 21/21 测试）：Dexie v2 新增 segments 表（++id）；`segmentMatching.ts` 起终点圆（半径 200m）顺序穿越匹配（入起点圈→离开起点圈→入终点圈；**计时起点 = 起点圈内最后一个记录点**——圈内停留持续刷新，出发停留/热身不计入；**环形路线防护**：起终点圆重叠时离开起点圈后回来才完赛，防"出发即完赛"；**相交圆并集防护**：圆心距 < 2R 时出起点圈但仍终点圈内的点不判完赛，防出发第一步撞终点圈产生秒级虚假成绩；单活动多次穿越取最佳、重新进入起点圈重新计时，与 Strava 单活动最佳成绩口径一致）+ 成绩榜按用时升序；详情页「设为赛段」按钮（首尾坐标点创建，无坐标禁用）；新页面 /segments（导航「赛段」）：卡片展示参与次数/最佳成绩（链接最快骑行详情）/删除；清空数据同步清 segments；导出 JSON 附带 segments（可选字段，v1 旧文件兼容，导入按名称+起终点判重）
- [x] **骑行区域统计**（✅ 7/7 测试）：`src/features/heatmap/gridCoverage.ts`：0.01°（约 1km）离线网格覆盖统计（同格去重，面积按网格中心纬度 cos 修正经度收缩）；热力图页摘要行展示「已探索 N 个 1km 网格（约 M km²）」
- [x] **年度回顾**（✅ 8/8 测试）：新页面 /year-review（导航「年度回顾」）；`src/features/yearReview/`（yearReview.ts 年份提取/月度聚合/年度范围 + MonthlyDistanceChart 月度距离柱状图）；年度十项指标复用 buildStatistics 自定义范围（YYYY-01-01~12-31）；年份 radio 仅有数据的年份，默认最新年
- [x] **年度分享图（社交分享）**（✅ 5/5 测试）：`yearReview/shareCard.ts`（纯 Canvas 2D 绘制 640×820 卡片：品牌行/大年份/四项年度指标/月度距离柱状图——最高月主题色高亮/落款，2x 缩放导出高清 PNG，爬升取整千分位；模型层 buildShareCardModel 纯函数）+ `ShareCardModal.tsx`（dialog 预览 + 下载 PNG，Esc/遮罩/按钮关闭）；年度回顾页「生成分享图」入口（年份行右侧）
- [x] **性能优化**（✅ 任务 #18，用户反馈卡顿治理，7/7 新增测试）：
  - **扫描合并 + 模块级缓存**：统计页功率纪录/路线分析两轮全量逐点扫描合并为一轮，结果按活动集合指纹（`scanCache.ts` summariesScanKey = 数量|总距离|最新时间，逐点导入后不可变故安全）缓存，离开再回来秒开；热力图轨迹、赛段成绩榜同款缓存
  - **详情页图表抽稀**：`charts/downsample.ts` 等距抽稀至 1000 点（保首尾），7 图表中 6 个喂抽稀数据；NP/区间/功率曲线/地图/GPX 仍用完整数据（精度不损）
  - **路由级代码分割**：App.tsx 除仪表盘/列表外全部 React.lazy（Leaflet 153KB 只随详情/热力图 chunk）
  - **fitsdk 移出主包**：错误类拆至 `fit/decoder/errors.ts`（fitDecoder 再导出兼容），importer 主线程降级改动态 import parseTask；主包 1019KB→628KB（gzip 250KB→190KB），fitsdk 391KB 只随 worker/降级 chunk
  - 死代码清理：getRouteEndpoints（合并扫描后被 extractEndpoints 取代）从仓库接口删除
- [x] **E2E 测试**（✅ 3/3 通过）：`playwright.config.ts`（webServer 自动起 dev server，workers=1 串行防 IndexedDB 互染）+ `e2e/smoke.spec.ts`：应用加载与导航、各页路由可达、核心链路「导入合成 FIT（tests/fixtures/cycling-gps.fit）→ 列表 → 详情」；`npm run test:e2e` 本地运行（不进 CI deploy）；vitest exclude e2e/ 防 .spec.ts 混入
- [x] **a11y 无障碍**（✅ 4/4 测试 `tests/a11y.test.tsx`）：列表标题列渲染为真实链接（stopPropagation 防重复导航）；MetricChart/CombinedChart 横轴切换按钮 role=group + aria-pressed；AppLayout 加「跳转到主内容」skip link（聚焦浮出）+ main#main-content + 主导航 aria-label；ImportPanel toggle aria-expanded。既有良好实践保留：表格行 tabIndex+Enter/Space、日历年份按钮 aria-label、趋势图 role=tab、着色切换 aria-pressed、范围选择 radiogroup
- [x] **品牌区回首页 + 数值单位同行**（纯 UI 调整）：AppLayout 品牌区改 `<Link>` 回仪表盘首页；仪表盘/统计页指标卡数值 `white-space: nowrap`，修复窄卡数值与单位（km/m）折行
- [x] **详情页指标卡扩充**：运动时长/总时长分列 + 新增累计下降（elevationLoss，缺失显示 — 不伪造），基础 10 卡，功率活动追加标准化功率
- [x] **地图全屏查看 + 缩放控件右下角 + 起终点标识区分**（✅ 8/8 测试）：`src/map/mapFullscreen.tsx`——FullscreenSync（fullscreenchange → `map.invalidateSize()` 防瓦片错位）、ZoomControlBottomRight（+/− 统一右下角，`map.zoomControl.setPosition`）、MapFullscreenButton（右上角悬浮按钮，Fullscreen API 作用于相对定位包裹层，Esc 退出按钮图标同步还原）；详情页轨迹图与热力图共用接入；终点标记改**黑白格完赛旗**（divIcon + CSS `repeating-conic-gradient` 棋盘格），起点保留绿色圆点
- [x] **品牌焕新：骑记 Ride Insight**（✅ 品牌区单测 + e2e 同步）：侧边栏品牌区更名「骑记 / Ride Insight」+ 副标题「看懂你的每一次骑行」；主题色对齐 logo——深色主题 `--primary` 荧光绿 `#b8e62e`、浅色主题深蓝 `#0d3b4c`（荧光绿白底对比度不足），新增 `--on-primary`（主色按钮文字色）；原 `#4f8cff` rgba 硬编码统一改 `color-mix(in srgb, var(--primary) …)` 随主题自适应；index.html/404.html 标题、分享图品牌行/落款/文件名/主色同步；logo 图标 `public/ride.png`（用户提供）接入侧边栏品牌区 + favicon（`import.meta.env.BASE_URL` 拼接适配子路径部署）
- [x] **详情页分段详情 splits**（✅ 10/10 测试）：`splits.ts` 按累计里程等长切片（段末取首个达段长记录，段距离按实际值；末段不足一段按实际距离收尾；用时/平均速度/平均心率逐段输出，心率缺失不伪造）；`SplitsSection.tsx` 默认 5 公里、可选 1/10/100/200 公里，表格列 段/距离/用时/时速/平均心率，随单位偏好换算，长表格滚动 + 表头 sticky；详情页挂载于图表区与训练区间之间（完整逐点数据）
- [x] **详情页训练效果栏**（✅ 4/4 组件测试 + 解码链路 18/18）：FIT 协议核实（官方 SDK 21.171 cpp 头文件为准）——单次有氧 TE = session `totalTrainingEffect`（字段 24）、无氧 TE = session `totalAnaerobicTrainingEffect`（字段 137），协议中不存在独立的 aerobic/anaerobic 字段号；decoder 按官方字段提取（SDK 21.213 原生支持，无需补丁）→ normalizer → Activity/ActivityEntity → repository 全链路落库；`trainingEffect.ts` 分档文案（Garmin 口径：<1 无效果/<2 恢复/<3 维持/<4 改善/<5 大幅提高/否则极限）；`TrainingEffectSection` 两行进度条渲染（有氧绿 `#22c55e`、无氧橙 `#f97316`，比例=值/5，progressbar 语义完整），单项缺失显示 —、两项均缺失区块不渲染（不伪造；用户现有 dabuziduo 设备数据不含 TE 字段，故历史活动不显示该栏）
- [x] **详情页成就栏（刷新纪录检测）**（✅ 纯逻辑 8/8 + 组件 4/4 + 集成 3/3）：`achievements.ts` 纯函数——仅与开始时间严格早于本次的历史活动比较（排除自身/更晚活动），维度 最远骑行/最长骑行/最多爬升/最快均速/最高平均功率，严格大于历史最大才算刷新，本次缺失不参评、历史全缺无可比纪录、首次骑行无成就（不伪造）；`AchievementsSection` 徽章列表（🏆 + 纪录名 + 本次值 + 原纪录，值随单位偏好换算），无成就不渲染；详情页经 `listAllSummaries` 加载历史（失败仅静默缺席），挂载于指标卡与地图之间
- [x] **详情页共享时间轴联动**（✅ 纯逻辑 14/14 + 组件 4+5+13）：`src/charts/timeline.ts` 纯函数（`findNearestByTimestamp` 二分 / `routePointAtTimestamp` / `routePointAtLocation` 100m 阈值 / `haversineMeters` / `seriesPointAtTimestamp`）+ 常量；`MetricChart`/`CombinedChart` 支持外部 `hoverTimestamp` + `onHover`（onMouseMove 上报 activeTooltipIndex、onMouseLeave 清除，`ReferenceLine ifOverflow="discard"` 处理 Brush 缩放超域）；Speed/Cadence/Power/Temperature/Elevation 五个薄封装透传；`ActivityMap` 新增 `hoverPoint`（CircleMarker r=7 悬停圆点）+ `onHover` + `MapHoverReporter`（useMap 监听 mousemove 反向联动，高德源按 GCJ-02 展示坐标匹配）；`ClimbSection` 剖面按坡度连续着色（Strava 坡度洞察风格：下坡蓝/平路绿/缓坡黄/中坡橙/陡坡红，60m 平滑窗口）+ UCI 级别徽章 HTML 覆盖 + 坡度图例，`onHover` 改时间戳上报 + 外部 `hoverTimestamp` 参考线；`ActivityDetailPage` 用 `hoverTimestamp` 统一接线（悬停任一图表/剖面/地图，其余全部联动参考线 + 地图圆点）
- [x] **详情页分段分析**（✅ 纯逻辑 7/7 + 组件 3/3）：`segments.ts`——`buildSegments` 把整条骑行切为「平路/爬坡」连续分段（首末平路 + 坡段之间平路，爬坡段复用 buildClimbs 但段终点**收敛到海拔峰值**，避免坡后平地被吞进坡段）；每段统计距离/爬升/平均坡度/平均速度/平均功率/平均心率（缺失不伪造）；`climbInsights` 相邻爬坡对比洞察（功率/速度百分比变化，<0.5% 或 0 基数跳过，双指标用「，但」连接）；`SegmentsSection` 分段卡片列表 + 洞察列表，无爬坡不渲染；详情页挂载于爬坡分析之后
- [x] **详情页骑行质量评分**（✅ 纯逻辑 10/10 + 组件 2/2）：`qualityScore.ts`——综合评分 = 有数据分项算术平均（0-100），分项 配速稳定性/心率控制/功率稳定性（变异系数，样本 <10 不评）、爬坡表现（坡段均功率/全程均功率，坡段止于峰值）、后程状态（后半程/前半程平均速度，距离中点切分）；缺失字段分项为 undefined、全缺综合分 undefined（不伪造）；`QualityScoreSection` 综合分大数字 + 分项得分条 + 总体评价档位文案（85/70/55 分档）；详情页挂载于指标卡之后
- [x] **训练计划生成**（✅ 纯逻辑 5/5 测试）：`src/features/training/plan.ts`——`buildTrainingPlan({ startDate, eventDate, weeklyHours, currentCtl })` 按周期化训练生成目标赛前逐周计划（阶段 base→build→taper→peak，TSS 渐进递增 + 峰值前递减，周骑行次数/时长按时长折算，目标日期早于起始/时长 0/CTL 负数返回空数组兜底）+ `estimateFtpFromPowerCurve`（功率曲线 20min 均值 × 0.95 估算 FTP，缺失数据返回 undefined）；`TrainingPlanPage.tsx` 表单（目标赛事日期 / 每周可投入时长 / 当前 CTL，CTL 未配置 FTP 时手动填写，默认目标 = 起始 + 12 周）+ 逐周卡片列表（阶段色标 / 周序 / 起始日期 / 目标 TSS / 骑行次数 / 时长 / 训练重点）；路由 `ROUTES[10]` + 侧边栏「训练计划」导航；挂载于赛段与设置之间

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
