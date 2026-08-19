# 项目进度与功能状态

> 本文档记录骑行数据分析网站（cycling-analyzer）的功能实现状态、架构边界与接口约定，
> 供后续开发（含 AI agent）继续工作参考。最后更新：2026-08-19（作者数据快照）。
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
| ✅ 已提交 | Strava 描述 + 估算功率展示 + 详情页铺满 | 已提交 `1604b98`（测试 631/631、lint/build 绿、本地快照验证 28 条描述 + 估算功率填充） | push 触发 CI（此前网络异常，随下次提交一起推送） |
| ✅ 已提交 | 版本信息 + LICENSE + README 图文重写 | 侧边栏底部显示 `v1.7.0`（vite define 注入 `__APP_VERSION__`）、`LICENSE`（MIT）、`scripts/capture-screenshots.mjs` 截线上站点 8 页真实数据图（docs/screenshots/）、README 重写 | push 触发 CI |
| 📌 待办 | 手动下载文件「机场东路有氧_平均心率138.fit」在 activities.csv 中无对应行 | 该活动无描述/估算功率（CSV 无匹配） | 用户可选：CSV 补行或改文件名，或保持现状 |
| ✅ 已提交 | 导入流程重构：批量导入数据源选择 + 单文件编辑弹窗 + 个人备注字段 | 同步面板新增「数据来源」下拉（Strava 解析 CSV / 佳明/igpsport/行者/其他按文件名还原）；选择单个 FIT 时弹「导入活动信息」框可编辑标题/说明/个人备注；`note` 新字段（模型/DB/仓库/详情页展示）；测试 636/636 + lint/build 绿 | push 触发 CI（随下次提交一起推送） |

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
| 骑行热力图（§39） | ✅ 5/5 测试 | `src/pages/HeatmapPage.tsx`（/heatmap 路由 + 侧边导航「热力图」）：全部活动轨迹 `simplifyRoute` 10m 抽稀后 **紫色 `#9333ea`、宽 3px、透明度 0.45** Polyline 叠加（OSM 浅色瓦片高对比，与详情页轨迹主蓝 `#4f8cff` 明显区分），重合路段自然加深形成热力；无坐标活动自动剔除，fitBounds 全轨迹视野；加载/空态/错误三态文案 |
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
