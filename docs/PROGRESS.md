# 项目进度与功能状态

> 本文档记录骑行数据分析网站（cycling-analyzer）的功能实现状态、架构边界与接口约定，
> 供后续开发（含 AI agent）继续工作参考。最后更新：2026-08-17（完整 Segment 赛段完成）。
>
> **维护规则**：每完成一个功能/阶段必须同步更新本文档（状态与文件清单），
> 再提交代码；进行中的任务标注"🔄 运行中"并注明负责 agent。
>
> 产品规格原文：`docs/个人骑行数据分析网站——Agent 开发规格说明.md`（规格 §N 引用即该文档章节）。

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

- 验证：**445/445 测试通过**，lint/build 全绿；线上 https://999bug.github.io/cycling-analyzer/ 可用
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
| Strava 标题还原 | `src/features/import/stravaExport.ts` | `parseStravaActivitiesCsv`（跨行引号/BOM 兼容），按文件名匹配 |

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
| 活动仓库 | `src/storage/repositories/activityRepository.ts` | `addActivity/addActivities/getById/getRecords/listActivities/countActivities/existsByFingerprint/updateName/updateNormalizedPower/deleteActivity/deleteAll/summarizeByRange/listAllSummaries/getRouteEndpoints`；listActivities 支持 sortBy(startTime/distance/duration)/month('2026-08')/activityType/search/offset/limit；getRouteEndpoints 走 activityId 索引 first/last 读取起终点坐标（路线分析用，免全量逐点加载） |
| 文件台账 | `fileRepository.ts` | recordImported/recordFailed/listAll/get/deleteAll |
| 设置 | `settingsRepository.ts` | get/set/delete（key/value unknown） |
| 赛段 | `segmentRepository.ts` | addSegment/listSegments/deleteSegment（v2 表） |

### 页面（规格 §13/§14/§15/§16/§17）

| 页面 | 路由 | 能力 |
|---|---|---|
| Dashboard | `/` | 本周/本月/总计（次数/距离/时长/爬升）+ 30/90/365 天趋势图；**订阅 importStore 导入后自动刷新** |
| Activity List | `/activities` | 排序/搜索/月份+类型筛选/分页 20/页；缺失字段 `—`；行点击跳详情 |
| Activity Detail | `/activities/:id` | 8 指标卡 + Leaflet 轨迹（Douglas-Peucker 抽稀 + 起终点标记 + fitBounds）+ 7 图表（速度/心率/踏频/海拔/功率/功率曲线/速度+心率组合，Tooltip/Brush/时间-距离轴）+ 删除（二次确认+级联） |
| Statistics / Calendar / Settings | `/statistics` `/calendar` `/settings` | ✅ P1 完成（见 §3）；统计页含「个人纪录」「设备统计」「路线分析」区块（P2，见 §3.1） |
| Heatmap 热力图 | `/heatmap` | ✅ P2 完成（见 §3.1：全部轨迹低透明度叠加） |
| Year Review 年度回顾 | `/year-review` | ✅ 后续项完成（见 §4：年份切换 + 年度指标 + 月度距离图） |
| Segments 赛段 | `/segments` | ✅ 后续项完成（见 §4：起终点圆穿越匹配 + 成绩榜） |

### 部署（规格 §34/§35）

- `.github/workflows/deploy.yml`：push main → lint → test → build → deploy-pages（Node 22）
- SPA 路由：`public/404.html`（rafgraph 方案）+ main.tsx `basename={import.meta.env.PROD ? '/cycling-analyzer' : '/'}`
- vite.config：`base: './'`，`@/` → src/ 别名，vitest jsdom + setupFiles

---

## 3. P1 阶段（规格 §38）已完成

### 已完成

| 功能 | 状态 | 文件与说明 |
|---|---|---|
| Statistics 统计页（§28） | ✅ Agent G，29/29 测试 | `src/features/statistics/`（statistics.ts 聚合 + RangeSelector + StatisticCards）；`resolveRange`/`buildStatistics` 可注入 now；范围：本周/本月/今年/12 个月/全部/自定义 |
| 轨迹颜色分析（§16 着色） | ✅ Agent J，32/32 测试 | `src/map/routeColoring.ts`（`buildSegments`/`buildBucketLines`/`getColorForValue`）；ActivityMap 新增 `coloring` prop（'none'\|'speed'\|'heartRate'\|'power'\|'altitude'，默认 none 向后兼容）；>500 段自动 8 桶合并 |
| 踏频/组合图组件（§17） | ✅ Agent K，24/24 测试 | `src/charts/CadenceChart.tsx`（rpm）；`CombinedChart.tsx`（mode: 'speedHeartRate'\|'powerHeartRate'，双 Y 轴 + 降级）；`buildCombinedSeries` 以首条有效记录为对齐基准；**未挂载详情页**（待 Agent L） |
| Calendar 日历页（§29） | ✅ Agent H，19/19 测试 | `src/features/calendar/`（calendarData 聚合 + CalendarHeatmap）；5 档距离色阶（20/50/100km 阈值）、tooltip（次数/距离/时长/爬升）、年份切换、订阅 importStore 自动刷新；hover-only（§29 未要求点击） |
| Settings 设置页 + 导出/导入/清空（§27/§32/§33） | ✅ Agent I，34/34 测试 | `src/features/settings/`（settings.ts/exportImport.ts/dataClear.ts）；**key 规范：`'profile'`（UserProfile 对象）+ `'units'`（UnitPreferences），按域合并保存，数据恒存公制**；导出 JSON v1（app/version/activities/records/files/settings），导入按 fingerprint 去重 |
| 高级数值筛选（§30） | ✅ Agent M，64/64 测试（含 6 新增） | `listActivities` options 新增 min/maxDistance（米）、min/maxElevationGain（米）、min/maxAvgPower（W），AND 组合含边界；**缺失 avgPower 的活动不满足功率条件**；UI 输入 km 自动转米 |
| 训练分析 + 详情页集成（§26） | ✅ Agent L，41/41 测试 | `src/features/analysis/`（normalizedPower.ts NP 30s 滑动平均 4 次方、intensity.ts IF/TSS、zones.ts 心率 60/70/80/90% + 功率 55/75/90/105% 5 区间，按记录时间间隔累计）；ActivityDetailPage：标准化功率卡 + 踏频图/速度+心率组合图挂载 + 轨迹着色切换（默认/速度/心率/功率/海拔）+ 训练区间区块（区间分布条 + IF/TSS）；**无 FTP/最大心率配置不伪造计算，显示引导文案** |

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
| 骑行热力图（§39） | ✅ 5/5 测试 | `src/pages/HeatmapPage.tsx`（/heatmap 路由 + 侧边导航「热力图」）：全部活动轨迹 `simplifyRoute` 10m 抽稀后低透明度（0.25）暖红 Polyline 叠加，重合路段自然加深形成热力；无坐标活动自动剔除，fitBounds 全轨迹视野；加载/空态/错误三态文案 |
| 单位换算显示（§27） | ✅ 7/7 新增测试 | settings.ts 新增 `formatSpeedByUnit`（km/h ↔ mph 随距离单位）；新 hook `src/hooks/useUnits.ts`（挂载读一次单位偏好，默认公制）；StatCards/TrendChart/ActivityListTable/StatisticCards/RecordCards/DeviceStatsCards/CalendarHeatmap 加 `distanceUnit` prop（默认 'km' 向后兼容），详情页复用已加载 settings（距离/速度 mi + 开始时间 12h '3:30 PM'）；四个页面接入 useUnits |
| 路线分析（§39） | ✅ 12/12 测试 | `src/features/routes/routeGrouping.ts`：贪心聚类（起点 500m 内 + 终点 500m 内 + 距离 ±10% 组均值容差，haversine 测距），输出按次数降序/最近骑行降序；repository 新增 `getRouteEndpoints`（activityId 索引 first/last 读取，避免全量逐点加载）；`RouteGroupCards.tsx` 统计页底部区块（路线 N 卡片：次数/平均距离/最快用时/最近骑行，点击跳最近详情）；完整 Segment（逐点匹配赛段）为后续工作项 |

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
- [ ] **README 完善**（§46）：基础版已写，截图等未补

### P2 之后的后续工作项（规格外延伸，逐项推进）

- [x] **导出 GPX**（✅ 7/7 测试）：`src/features/activity/gpxExport.ts`（GPX 1.1 构造：trkpt 7 位坐标 + ele + time，XML 转义，无坐标返回 undefined 不伪造；文件名去 .fit/.fit.gz 后缀）；详情页标题区「导出 GPX」按钮（无轨迹坐标禁用），Blob 下载
- [x] **完整 Segment 赛段**（✅ 21/21 测试）：Dexie v2 新增 segments 表（++id）；`segmentMatching.ts` 起终点圆（半径 200m）顺序穿越匹配（先入起点圈再入终点圈，计时=两进入事件秒差，单活动取首次完整穿越）+ 成绩榜按用时升序；详情页「设为赛段」按钮（首尾坐标点创建，无坐标禁用）；新页面 /segments（导航「赛段」）：卡片展示参与次数/最佳成绩（链接最快骑行详情）/删除；清空数据同步清 segments；导出 JSON 附带 segments（可选字段，v1 旧文件兼容，导入按名称+起终点判重）
- [x] **骑行区域统计**（✅ 7/7 测试）：`src/features/heatmap/gridCoverage.ts`：0.01°（约 1km）离线网格覆盖统计（同格去重，面积按网格中心纬度 cos 修正经度收缩）；热力图页摘要行展示「已探索 N 个 1km 网格（约 M km²）」
- [x] **年度回顾**（✅ 8/8 测试）：新页面 /year-review（导航「年度回顾」）；`src/features/yearReview/`（yearReview.ts 年份提取/月度聚合/年度范围 + MonthlyDistanceChart 月度距离柱状图）；年度十项指标复用 buildStatistics 自定义范围（YYYY-01-01~12-31）；年份 radio 仅有数据的年份，默认最新年
- [ ] **性能优化**：页面切换卡顿治理（用户实测反馈），见任务 #18
- [ ] **E2E 测试**（Playwright）：覆盖导入→列表→详情核心链路
- [ ] **a11y 无障碍**：键盘导航/对比度/aria 审查

---

## 5. 架构与接口约定（agent 工作须知）

### 模块边界（规格 §42，硬约束）

```
FIT Decoder → Normalizer → Calculator → Storage Repository → UI
```

- React 组件**禁止**直接调用 `@garmin/fitsdk`
- UI 只依赖 `src/types/activity.ts` 领域模型与 storage repository 接口
- 新增功能先定位到对应层，跨层直接调用视为违规

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
npm run lint       # ESLint
npm run build      # tsc + vite build
node tests/fixtures/generate-samples.mjs   # 重新生成合成 FIT 样例
```
