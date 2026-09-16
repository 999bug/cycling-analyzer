# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

个人骑行数据分析网站（Strava Lite）：纯前端、数据完全本地化，FIT 文件在浏览器内解析，数据存 IndexedDB，部署 GitHub Pages。产品规格与功能状态见 `docs/PROGRESS.md`（进行中任务清单、未实现工作项、架构接口）；整体架构与图见 `docs/架构总览.md`；**提交与发布流程、并行会话约定、关键坑见根目录 `AGENTS.md`（动手前必读）**；已完成功能的详细记录在 `docs/archive/`（`PROGRESS-archive-2026-08.md` / `-2026-09.md`）。

## 常用命令

```bash
npm run dev                 # 本地开发（默认 5173 端口）
npm run check               # 提交前快速验证（tsc -b + 改动文件 lint + 相关测试，约 30s）
npm run check -- --full     # 全量 lint + 全量测试（大改动 / 排查时用）
npm run test                # 全量测试（vitest run，181 个文件 / 1745 用例）
npx vitest run tests/fit/decoder.test.ts   # 单文件测试
npm run lint                # ESLint（flat config）
npm run build:author-data   # 作者数据快照全量重建（实测约 7s；坏 FIT 跳过并告警，--fail-fast 才是严格模式）
npm run build               # tsc -b + vite build（本地通常不需要，构建由 CI 兜底）
npm run test:e2e            # Playwright e2e（已进 CI，失败即阻断发布）
npm run bench:data-layer    # 数据层基线测量（口径：IndexedDB 实际解出多少行/点数，非耗时）
npm run check:snapshot-size # 快照产物体积门禁
npm run curate -- --spec <需求单.json>     # 精选路线半自动添加（--dry 试运行不落盘）
```

代码修改后执行 `codegraph sync` 同步索引。

## 架构

### 数据分层（硬边界，规格 §42）

```
FIT Decoder → Normalizer → Calculator → Storage Repository → UI
```

- `src/fit/decoder`：封装 @garmin/fitsdk。**Stream 的 isFIT/checkIntegrity 必须在 read() 前调用**（read 消费 stream 后误报 false）
- `src/fit/normalizer`：SDK 结构 → 领域模型（半周→十进制度、Date→Unix 秒）
- `src/fit/calculator`：统计计算（爬升=相邻正增量、平均速度=距离/时长、移动时长口径见下）
- `src/storage`：Dexie 库 `cycling-data`（`DB_VERSION = 9`）：`activities` 摘要 / `activity_chunks` **逐点分片主存储**（v9，每活动 N 片、2000 点/片，复合主键 `[activityId+seq]`）+ `activity_blobs`（v5~v8 整活动行，**只作迁移源，不再写入**）+ `activity_records`（v4 逐点行表，迁移兜底）、`files` 台账、`settings`、`segments`、`segment_efforts`；缓存表 `tile_cache` / `scan_cache`；两层迁移共用 `migrationLock.ts`
- `src/features/*`：业务功能域，共 19 个（import / activity / analysis / ai / share / dashboard / statistics / segments / heatmap / routes / curatedRoutes / calendar / records / insights / training / yearReview / settings / pwa / changelog）
- `src/pages`、`src/charts`、`src/map`：页面与展示组件（15 条路由）

**约束**：React 组件禁止直接调用 `@garmin/fitsdk`；UI 只依赖 `src/types/activity.ts` 领域模型与 repository 接口。各功能域职责与四张架构图见 `docs/架构总览.md`。

### 关键设计决策

- **领域模型是唯一跨层契约**（`src/types/activity.ts`）：单位固定（米/m/s/bpm/rpm/W、Unix 秒、十进制度）；**缺失字段 = undefined ≠ 0**（规格 §25），UI 显示 `—`
- **摘要与逐点分表**：activities 表不存 records；`getById` 返回摘要，`getRecords` 按需加载。逐点数据的**存储布局封装在 repository 内部**，对外契约始终是 `ActivityRecord[]`：v5 曾用「每活动一行」（`activity_blobs`，解决了 IndexedDB 无批量删除导致的逐行慢删），但「按区间读」时也得整行解出——详情页读 100 点解出 15.4MB、导出分批读放大 11 倍；**v9 改分片**（`activity_chunks`，按 `[activityId+seq]` 复合主键范围查询，只取覆盖目标区间的片）。读取顺序 chunks → blobs → records，后两级命中时按**当前**布局回填，与后台迁移双向收敛。迁移分两层（`recordsMigration.ts` v4→v5、`chunksMigration.ts` v5→v9），**共用 `migrationLock.ts` 的 CAS 锁 + 心跳续期**——这套并发语义写错一次就丢数据，不得复制成两份
- **大范围逐点扫描一律用 `iterateRecordBatches(ids, visit, { batchSize })`**（默认 16 活动/批）：`getRecordsByActivityIds` 的返回值是 `Map<活动, 全量记录>`，峰值 = 所有活动逐点之和（实测 500 活动 × 2000 点 = 154MB）；分批流式后 4.9MB。回调**串行**、返回 `false` 可提前终止，**不要在回调里长期持有 batch**。作者源实现刻意返回空记录（与本类既有语义一致），改动它等于改变访客侧行为
- **性能改动必须先有基线数字**：涉及查询 / IO / 构建的优化，先用 `npm run bench:data-layer`（数据层，口径是「IndexedDB 实际解出多少行/点数」而非耗时）或直接实测取证，不接受「应该会更快」。本项目已有**三项**计划优化被实测否掉（keyset 分页、快照增量构建、产物 gzip / 按年分片），省下的返工多于省下的代码
- **去重指纹基于解压后内容**（`.fit` 与 `.fit.gz` 同一活动判重一致）
- **Strava 标题还原**：CSV 文件名匹配（`src/features/import/stravaExport.ts`），跨行引号感知
- **佳明 GDPR 导出包适配**：FIT 封装在包内层 `UploadedFiles_*.zip`，扫描器 `expandArchives` 递归展开 zip（fflate，深度 2）；标题还原按摘要 JSON `startTimeGmt` 与 FIT 开始时间 ±2s 匹配（`src/features/import/garminExport.ts`，与文件名无键关联）
- **运动类型归一化**：判断是否骑行一律用 `src/types/activityType.ts` 的 `isCyclingType()`，**禁止在业务代码里比 `=== 'cycling'`**（库里可能存有 `road_biking`、Strava 中文「骑行」等原始写法）。分析类页面取数必须走 `listCyclingSummaries(repository)`，且过滤要发生在 `summariesScanKey()` 之前（缓存指纹先于过滤会永久命中脏缓存）。存量修正需「只读检测 → 用户确认 → 才写入」，不静默改写历史统计
- **运动时间口径单一来源**：`src/features/activity/movingTime.ts` 是唯一判定处，`calculator.estimateMovingDuration`（计时时长）与 `map/replayCore.buildMovingTimeline`（回放时间轴）共用，禁止各自复制阈值；判定源必须是未抽稀的密集记录
- **SPA 路由**：`main.tsx` basename 生产 `/cycling-analyzer`、dev `/`；`public/404.html` 处理深链接；`/changelog`、`/acknowledgments` 是兼容旧链接的路由，真实入口在设置（「更多」）页分区
- **导入在 Web Worker 解析**（jsdom 自动降级主线程），失败进台账可重试；赛段匹配同样有独立 Worker
- **双数据源**：`dataSourceStore` 管理「作者的数据（CI 构建的静态快照，只读）/ 我的数据（本地 IndexedDB）」；组件统一经 `useActivityRepository()` 获取当前源的仓库，训练配置经 `getEffectiveProfile(source)` 随源切换；作者源下写操作 UI 一律隐藏；`authorVisibility` 支持「有本地数据时自动隐藏作者档」
- **地图底图**：默认**高德 GCJ-02**（合规白名单：腾讯/高德/百度/天地图），连续 3 张失败且期间无成功才降级 OSM（WGS-84），sessionStorage 记忆（`cycling-map-tile-fallback`）；高德底图上展示坐标统一做 WGS-84 → GCJ-02 转换（`src/geo/projection`，境外原样返回）。底图模式三档（正常 / 卫星 / 卫星+路网，`src/map/tileSources.ts` 的 `MAP_MODES`）**不持久化**，默认恒为「正常」。本地预缓存瓦片（`public/author-data/tiles/`）只服务「正常」模式
- **AI 接入（BYOK，无后端代理）三条红线**：① API Key 只存 localStorage 独立 store（`aiConfigStore`，键 `cycling-ai-config`），**绝不入 Dexie settings 表**（该表会被「导出数据」整表写进备份）；② 上行只有聚合指标，`aiPrompts.buildAiMetricsPayload` 是唯一 prompt 组装入口，**GPS 轨迹点与逐点序列不出本机**；③ 未配置供应商时全部 AI 入口不渲染，AI 文案只是可改的草稿。诊断日志 `aiDebugLog` 独立存储、不含提示词与 Key。详见 `docs/架构总览.md` §9
- **分享出图有两条链路，都不要删**：真实界面舞台（`ShareStageShell`，恒 1080×1440 布局尺寸，朋友圈 1 图 / 小红书 4 页常驻挂载，出图前等瓦片稳定）与极简手绘 Canvas（`shareCanvas`，无底图零请求，快照不可用时降级到它）。**预览缩放只能挂弹窗插槽的 transform，绝不能缩舞台或外层容器的布局尺寸**（Leaflet `getSize()` 读 `clientWidth`，成图会糊）。详见 `docs/架构总览.md` §10
- **分享 / 录像等画布场景**必须给瓦片层传 `crossOrigin`，否则跨域瓦片 `drawImage` 污染画布、`toBlob` 直接抛错

### 测试约定

- Vitest + jsdom；DB 测试用 `fake-indexeddb`（tests/setup.ts 已全局注册）+ 真 Dexie 实例注入
- FIT 样例在 `tests/fixtures/`（Garmin 官方公开样例 + 合成带 GPS 文件，不包含个人真实数据）
- 纯函数优先可测；页面测试用 MemoryRouter；数据加载支持注入；mock `getBoundingClientRect` 让 Recharts 可渲染
- `tests/setup.ts` 全局 mock 了 `@/map/CachingTileLayer`，需要真实实现的测试须用 `vi.mock(..., importOriginal)` 覆盖
- **逐点数据的 `beforeEach` 必须把三种布局全清**（`activity_chunks` + `activity_blobs` + `activity_records`）：只清其一时，上一条用例的轨迹会从兜底读路径漏进本条用例（已踩过）
- **`private-fixtures/` 为用户真实骑行数据，gitignored，严禁提交或引用进测试**

## 代码与提交规范

- 注释中文；日志/异常消息英文；`@/` 别名导入；React 组件 `function` 声明
- 提交前缀 `[NF]`/`[BF]`/`[IM]`/`[CU]` + 中文 Subject，**无 AI 署名**
- **提交格式（参照 `9d36a88`，勿回退到单行长 Subject 风格）**：
  - Subject 一句话概括本次提交做了什么（简洁、不堆砌细节），前缀后无冒号
  - 细节全部放正文 bullet list（`-` 开头）：新增/修改了什么文件与函数、关键实现点、测试情况（如「全量 NNN/NNN + lint/build 绿」）、文档同步说明
  - 版本号变更写进正文 bullet（如 `- 版本 2.12.0 → 2.13.0`），不追加在 Subject 尾部
  - 正例：Subject「[NF] 详情页报告化：一句话总结 + 核心指标精选 + 更多指标折叠」+ 正文逐条列文件与测试
  - 反例（已废弃）：把全部功能点用「+」串进一行长 Subject 并以「版本 X.Y.Z」结尾
- 提交身份固定 `999bug <999bug@users.noreply.github.com>`（项目级 git config，勿改）
- 改动前先读 `docs/PROGRESS.md` 确认现状，避免与进行中的任务冲突
- **每完成一个功能/阶段必须同步更新 `docs/PROGRESS.md`**（状态与文件清单）再提交代码，保持文档与代码同步
