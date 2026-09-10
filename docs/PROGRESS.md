# 项目进度与功能状态

> 本文档记录骑行数据分析网站（cycling-analyzer）的功能实现状态、架构边界与接口约定，
> 供后续开发（含 AI agent）继续工作参考。最后更新：2026-09-10（[NF] 设置页布局优化：单列改双栏 + 左侧锚点目录。左栏「个人信息 + 单位」需点「保存设置」生效，右栏「外观 / 数据口径 / 离线地图 / 导入 / 作者数据」即改即生效，数据管理 / 安装应用 / 关于改底部通栏；目录九项点击直达并高亮当前区块，内容区 <900px 退回单栏、移动端隐藏目录；版本 2.61.0。此前 [IM] 2.60.1 为回放录屏技能入库，[NF] 2.60.0 为导出视频体验优化，2.59.0 为详情页地图开放底图切换，2.58.0 为导出视频改录制真实页面，2.57.0 为地图模式切换下沉，2.57.1 为记忆目录拆分，2.56.0 为导出视频选项面板）。
>
> **维护规则**：每完成一个功能/阶段必须同步更新本文档（状态与文件清单），
> 再提交代码；进行中的任务标注"🔄 运行中"并注明负责 agent。
> **每个任务开始前先登记到 §0 进行中任务清单，完成后移出**（防中断丢失进度）。
>
> 产品规格原文：`docs/个人骑行数据分析网站——Agent 开发规格说明.md`（规格 §N 引用即该文档章节）。

---

## 0. 进行中任务清单（中断恢复必读）

> 用途：任务中途因上下文满 / 费用不足 / 手动停止而中断时，agent 先读本节定位进度，
> 避免重复工作或遗漏。**每开始一个新任务在此登记；每完成一步更新状态；全部完成并提交后移出**。
> **只登记未完成/搁置事项**——已完成条目随归档流程迁入 `docs/archive/`，不在本表堆积。

| 状态 | 任务 | 进度 | 下一步 |
|---|---|---|---|
| 🔄 运行中 | **代码审计遗留项（按 docs/代码审计报告-2026-09-01.md 路线图）** | 审计主体批次与首屏体积项已完成；SimilarRides 全量轨迹驻留问题已在 2.51.11 改为摘要首尾坐标优先，旧活动按需回退；跨时区日期筛选回归测试已在 2.51.12 固定东八区边界；Strava 历史 Token 已在 2.51.13 进入赛段页面时清理；流式导出已在 2.51.14 恢复 2 空格 JSON 层级；批量重命名、删除和纠偏已在 2.51.15 统一本地日期。剩余修复：工程清理；Vite PWA 插件内部仍有 `inlineDynamicImports` 弃用提示，待插件版本支持后再迁移 | 继续按子项单独提交 |
| 📌 待办 | 手动下载文件「机场东路有氧_平均心率138.fit」在 activities.csv 中无对应行 | 该活动无描述/估算功率（CSV 无匹配） | 用户可选：CSV 补行或改文件名，或保持现状 |
| ⏸️ 已搁置 | **小程序原生重构**（零域名方案；代码保留在 `feature/miniprogram` 分支，main 不含小程序代码） | 2026-08-26 决策搁置：Phase 0~3 已完成但体验与网站差距大（Canvas 手绘图表 vs Recharts、地图组件封闭、wx.chooseMessageFile 批量导入残废、发布需审核），微信限制与产品核心能力根本冲突。移动端入口改走 Web PWA 安装引导（2.27.0）。分支未删除，如重启可从 Phase 4 地图继续 | 无（不再推进） |
| ⏸️ 已暂缓 | **功能队列剩余项**（用户 2026-08-26 确认价值不高，暂不推进） | 目标设定与进度 / 比赛预测 / 路线规划器（画路线导出 GPX）/ 骑行记录 CSV 批量导出 | 后续有需求再启动 |

---

## 1. 已完成内容归档

已完成功能的详细清单分两卷：

- **`docs/archive/PROGRESS-archive-2026-08.md`**：至 2026-08-24（版本更新日志页上线为止）——阶段总览、按规格章节的已完成功能清单、P1/P2 阶段明细、作者数据快照、规格外延伸工作项（GPX 导出/赛段/热力图/年度回顾/性能优化等）。
- **`docs/archive/PROGRESS-archive-2026-09.md`**：2026-08-24 → 2026-09-08（2.13.0 → 2.38.0）——UI 体验改造系列、PWA 安装引导/更新提示条、在线回放、佳明 GDPR 导入、导入三步向导、行者/Strava 口径对齐等全部已完成条目。

需要查历史实现细节时再读归档文件；日常开发只需关注本文档的 §0 进行中任务、§5 架构约定和 §6 UI 任务队列。**版本功能摘要看 `src/features/changelog/changelogData.ts`（changelogPage 测试断言其与 `__APP_VERSION__` 同步）**。

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
- **作者数据可见性（v2.48.0）**：作者数据定位为「空状态示例」。`dataSourceStore.authorVisibility: 'auto'|'show'|'hide'`（persist），auto = 本地有活动即隐藏（运行时 `hasLocalData` 判定，清空本地后自动回来）；`selectEffectiveSource` 在作者源被隐藏时无缝回退 local；切换器在作者档不可用时整体不渲染（`DataSourceSwitcher`）。配套：`AuthorHiddenNotice` 一次性提示（`authorHiddenNoticePending` persist，「去设置」跳 `/settings#author-data` 高亮）；深链兜底 `peekAuthorData`（运行时，仅详情页会话有效，显式切源即清除，设置值不动）；`initDataSource` 启动探测本地活动数（countActivities），导入成功/清空后同步 `setHasLocalData`
- **运动时间口径（v2.52.1 起，单一来源）**：`src/features/activity/movingTime.ts` 是「相邻点是否处于运动中」的唯一判定处——正常间隔（≤30s）按位移速度 >0.5m/s、短缺口（30~60s）按两端位移 ≥8m、长缺口（>60s）整段剔除。两个消费方共用，禁止各自复制阈值：
  - `fit/calculator` 的 `estimateMovingDuration` → GPX 等无 session 数据的「计时时长」（即均速分母）；
  - `map/replayCore` 的 `buildMovingTimeline` → 在线回放与回放视频导出的时间轴（暂停段压缩为 0 长度，只重映射 timestamp、几何点不丢）。
  由此回放总时长等于记录的移动时长（GPX 等无 session 数据即活动计时时长）——**但判定源必须是密集逐点记录**：详情页展示点经 Douglas-Peucker 抽稀，采样间隔可达分钟级（实测 2102 条记录抽成 54 点、相邻间隔中位 29s 最大 155s），直接拿它判定会把正常骑行段误判成暂停（>60s 规则），实测一份 35 分钟骑行被折掉 1047s、光标横跨 1010m 瞬移。因此 `TrackReplay` 的 `motionSource` / `ActivityMap` 的 `replayMotionSource` 必须传未抽稀的 `cleanedRecords.cleaned`
- **回放覆盖层禁止用内联 props（v2.52.3 起，硬约束）**：React 组件**不得**直接命令式操作 Leaflet 图层后，又给该图层传内联的 `positions={[]}` / `center={[...]}` / `pathOptions={{...}}`——react-leaflet 对 `positions`/`center` 做 `!==` 身份比较，新对象会触发 `setLatLngs([])` / `setLatLng(起点)`，把帧广播写入的状态**打回初始态**（播放中 10Hz 快照重渲染 + 拖动进度暂停态都会命中，实测拖动后圆点弹回起点、橙线消失）。覆盖层的这些 props 一律用模块级常量或 `useMemo` 稳定引用，几何状态只经帧广播命令式更新
- **回放时间轴的两条不变量（v2.52.6 起）**：`buildMovingTimeline` 的单段时钟增量 = `clamp(位移 / MAX_CURSOR_SPEED_MPS, 运动时长, 该段真实间隔)`，因此恒有 **运动时长 ≤ 回放总时长 ≤ 活动总耗时**。下限折叠暂停；上限保证光标不瞬移——设备停记/丢 GPS 期间真骑出去的距离会落在「被判为暂停的记录缺口」里（实测单段最大 3153m），补时后光标平滑滑过，且 GPS 抖出的假位移因真实间隔极短而不会被补时。全量 165 份真实轨迹回归：异常段（等效光标速度 >30m/s 或时钟增量为 0）旧 8640 → 新 0；最大单段跳 3153m → 38.9m（唯一残留为 1 秒内 38.9m 的 GPS 飞点，真实间隔已用满无从补时）
- **底图与定位合规（v2.53.0 起，硬约束）**：合规白名单＝**腾讯 / 高德 / 百度 / 天地图**；OSM、OpenTopoMap、Google、Bing 海外版、Mapbox 等一律不作为面向用户的主底图。现状：默认源与全部地图模式都用高德（GCJ-02），OSM 仅作「高德连续 3 次瓦片失败」时的可用性兜底（**用户 2026-09-10 决定保留**，面向国内发布时需重新评估）。地图模式 `MAP_MODES`（`src/map/tileSources.ts`）三档，全部同坐标系，**切换模式不触发轨迹重新投影**：
  - 「正常」＝`webrd0{1-4}` + `style=8`（不透明矢量底图 + 路网 + 注记，与默认瓦片源同址）；
  - 「卫星」＝`webst0{1-4}` + `style=6`（JPEG 影像，无注记）；
  - 「卫星+路网」＝影像底图 + `webst0{1-4}` + `style=8`（**透明**注记叠加层，实测 80% 像素 alpha=0；注意同名 `style=8` 在 webst 域才是透明注记层，在 webrd 域是不透明矢量底图）。
  **已移除 OpenTopoMap 地形层**：境外 OSM 系服务国内基本加载不出（表现为「点了没反应」），且其为 WGS-84 而底图/轨迹为 GCJ-02，即便加载成功也会整体错位数百米。瓦片降级到 OSM 后模式按钮置灰（`mapModeEnabled`），避免再次出现「点了没反应」。地图模式记忆在 localStorage（与地图高度同为用户偏好，共享实现见下方 v2.57.0 条目）；`FallbackTileLayer` 的 `mapMode` 为可选参数，未开放切换的用图组件（CompareSection / SegmentMiniMap）保持缺省「正常」
- **回放控制栏布局约定（v2.53.0 起）**：控制栏**通栏贴地图底部**（`bottom/left/right: 0`，只有上圆角）。它压在右下角 `.leaflet-bottom.leaflet-right`（缩放 + 版权署名）之上，因此 `TrackReplay` 用 ResizeObserver **实测自身高度**写入地图容器的 `--replay-bar-height`，`ActivityMap.css` 据此给该角加 `margin-bottom` 把控件抬上去——窄屏按钮换行导致控制栏变高也不会被挡；署名只上移不隐藏（底图版权必须可见）。播放中整条控制栏淡出到 `opacity: 0.2`（`.track-replay--playing`），`:hover` / `:focus-within` 恢复——触摸设备无 hover，但透明度不挡点击，点按带来的 focus 同样能恢复。以后改控制栏尺寸/位置时注意别再压住这两个控件

- **地图视野适配（v2.56.0 起）**：`ActivityMap` 的 `FitBounds` 除「轨迹点变化」外还监听 Leaflet 的 `resize` 事件重新 `fitBounds`——`invalidateSize()` 只保持 center + zoom、**不重算缩放级别**，全屏进出 / 窗口缩放 / 拖动地图高度后必须重算，否则轨迹缩成画面中间一小团（实测横向仅占 44%，按 fitBounds 本应约 96%）。尊重用户操作：`dragstart`（纯用户行为）与自动适配之外的 `zoomstart` 会置用户操作标记，此后尺寸变化不再自动适配；换活动（points 变化）时重置。改这里注意别把「自动 fitBounds 自身触发的 zoomstart」误判成用户操作
- **导出回放视频（v2.56.0 起）**：`features/activity/trackVideoExport.ts` 的画布比例/时长/字幕全部参数化（`VIDEO_ASPECT_SIZES` 短边统一 1080；`canvasLayoutOf` 按短边算安全边距与各号字号）。底图恒用高德栅格瓦片（`mapModeOf()` 的图层栈，含「卫星+路网」双层叠加），**因此轨迹必须先经 `@/geo/projection` 的 `projectPoint` 投影到 GCJ-02**，否则整条轨迹整体偏移。时长档位 15/30/60 秒或「跟随里程」（每 5 km 1 秒，夹在 15~60 秒）；字幕取活动真实数据，缺失项整行省略。选项面板 `VideoExportDialog` + `videoExportSettings.ts`（选项模型 + localStorage 记忆）只负责收集参数，录制由详情页 `handleExportVideo` 执行并展示整秒进度
- **导出视频双路线：优先录真实页面，失败回退内置绘制（v2.58.0 起，硬约束）**：详情页「生成竖屏视频」有两条链路，**都不要删**：
  1. **录制真实页面**（`features/activity/pageCaptureExport.ts`）——`requestTabCaptureStream()` 在**用户手势内**调 `getDisplayMedia`（`preferCurrentTab` + `selfBrowserSurface: 'include'`）拿标签页视频流，随后地图切成 **CSS 录制舞台**（`.map-export-stage` 全屏黑底 + `.map-export-frame` 居中竖屏画框，`ActivityMap` 用 `ExportFrameSync` 子组件 `classList.toggle` 挂摘，因为 `MapContainer` 的 className 只在首挂生效），按目标时长反推倍速（`speed = max(1, round(movingSeconds / durationSeconds))`）经 `ReplayExportSession` 自动开播；rAF 合成循环用 `cropSourceOf()` 只裁画框区域 → 成片里不带两侧黑边。**必须避开 Fullscreen API**：`requestFullscreen` 与 `getDisplayMedia` 都消耗用户手势，同一手势连续调用后者必失败；瓦片要等 `waitForTilesSettled` 稳定再开播，否则片头是空白底图。
  2. **内置 canvas 自绘**（`trackVideoExport.ts`，v2.56.0 那条）作为兜底——浏览器不支持、用户拒绝授权、或非安全上下文时自动回退（`handleExportVideo` 用 `??` 串起来），功能与观感同 2.56.0。
  **两条路线字幕同源**：`trackVideoExport.ts` 导出的 `drawVideoCaptions()` 与 `pickVideoMimeType()` 供录制链路复用，改字幕内容只需改一处。**字幕可自定义（v2.60.0 起）**：`buildVideoCaptionTexts` 接受 `hookText` / `dataLineText`，非空时**整块覆盖**自动生成、空串回退自动（`splitCaptionLines` 按换行拆行）；面板 `VideoExportDialog` 预填自动文案供改，清空或点「恢复默认」回到自动，存储里「与自动文案一致」按空串记（否则换活动会带串味数字）。**画框两边只靠比例对齐，不锁像素**：CSS 侧 `.map-export-frame` 用 `aspect-ratio: 9/16` + `height: calc(100% - var(--export-status-height, 64px))` 随窗口高度自适应（顶部给录制状态条让位），合成侧 `canvasLayoutOf('9:16')` 固定 1080×1920，`cropSourceOf()` 按 `videoWidth / documentElement.clientWidth` 缩放换算裁剪矩形——**改任一侧比例时必须同步改另一侧**（当前同为 9:16）。
  **录制性能与中断（v2.60.0 起，硬约束）**：合成循环**必须节流到录制帧率**（`DRAW_INTERVAL_MS = 1000/30`，别用全速 rAF 白烧 CPU）；画框矩形用 `cropSourceOfWithRect` + `FRAME_CACHE_TTL_MS` 缓存，别每帧 `getBoundingClientRect`（会 layout thrash）。会话额外暴露 `interrupted` Promise——用户在浏览器「停止共享」提示条点停止时 resolve，页面据此 `Promise.race`（回放终态 vs 中断）**立即收尾回到原页面**，否则会空等回放终态而卡死。录制舞台顶部状态条 `.activity-map__export-status` 位于画框外黑边区、不进成片（`cropSourceOf` 只裁画框），改其高度需同步改 `--export-status-height`。
- **本地预缓存瓦片只服务「正常」模式（v2.56.0 起，硬约束）**：`public/author-data/tiles/` 清单 key 只有 `"z/x/y"`、不含底图模式，故 `CachingTileLayer` 的 `allowLocalTile` 必须由 `FallbackTileLayer` 按 `mapMode === 'normal'` 传入；否则卫星与注记请求会命中本地矢量瓦片，作者快照覆盖区域出现「矢量/卫星混杂」。备选方案（清单 key 加模式前缀）需预缓存两套瓦片、体积翻倍，不采用
- **⚠️ 测试环境约定**：`tests/setup.ts` 全局 mock 了 `@/map/CachingTileLayer`（避免全量渲染时真实发包）；需要真实实现的测试文件必须用 `vi.mock(..., importOriginal)` 覆盖回原样（见 `tests/map/cachingTileLayer.test.tsx`）
- **地图模式切换的多处入口（v2.57.0 起，v2.59.0 补详情页非回放态）**：共享实现为 `src/map/MapModeSwitcher.tsx`（悬浮分段控件）+ `src/map/useMapMode.ts`（`[模式, 切换回调]`，切换即写 `cycling-map-mode`）。**详情页有两处入口且互斥**：非回放态用 `ActivityMap` 右下角的角标（`{!replayEnabled && <MapModeSwitcher/>}`），回放态由 `TrackReplay` 控制条内的紧凑版负责——两处同时出现会重复，且角标贴右下角会与通栏控制栏堆在一起，故判据取 `replayEnabled`（是否启用回放）而非「是否正在播放」。`ActivityMap` 目前只有详情页一个生产调用方，父级必须同时传 `mapMode` + `onMapModeChange`（不传时角标点了无反应）。热力图、路线图、详情页、视频导出「跟随当前」共用同一份记忆，任一处切换其余立即沿用。底图降级到 OSM 时整组禁用（`enabled={isGcjSource(sourceIndex)}`）。`MapModeSwitcher` **只提供地图角标形态**；控制条里的紧凑版仍由 `TrackReplay` 自行渲染，别把角标样式套到控制条上。角标贴地图右下角，`mapModeSwitcher.css` 用 `:has()` 把 Leaflet 右下角控件（缩放 + 署名）整组上抬 56px 让位——**改控件高度时必须同步改这个值**（与回放控制栏用 `--replay-bar-height` 抬升是同一思路的静态版）。导出录制舞台 `.map-export-stage` 需隐藏角标（连同拖拽把手、全屏按钮），否则控件会进成片。热力图在卫星模式下热力线换亮紫 `#c084fc` 且不透明度 0.45 → 0.7（`isSatellite` 派生自 `mapMode !== 'normal'`），矢量底图维持深紫 `#9333ea`
- **地图悬浮控件的字色一律写死浅色（v2.57.0 起）**：底图角标类控件（全屏按钮、模式切换、回放控制栏）压在矢量底图与卫星影像上，配色固定为「深色半透明底 + 浅色字」，**不要用 `var(--text)` / `var(--border)`**——`mapFullscreen.css` 曾用主题变量，浅色主题下是深字压深底、按钮几乎看不见

- **运动类型与骑行统计口径（v2.55.0 起，硬约束）**：`src/types/activityType.ts` 是类型归一化的唯一入口——**判断是否为骑行一律用 `isCyclingType()`，禁止在业务代码里比 `=== 'cycling'`**，因为库里可能存有各平台原始写法（佳明 `road_biking`、Strava 中文「骑行」；实测佳明 GDPR 摘要 85 条中 84 条为 `road_biking`）。判据优先级：Strava `activities.csv` 活动类型 > FIT `session.sport` > GPX `<trk><type>` > 速度特征兜底（`features/activity/activityTypeInference.ts`，导入与作者快照构建共用 `resolveActivityType`）。
  - **速度只能单向使用**：「快」是封闭的（马拉松世界纪录 ≈21.0 km/h、竞走 ≈13.5），故高速可可靠排除跑步；「慢」是开放的（共享单车 10~13、带娃 8~10、山地爬坡 9~12、折叠车 12~15），**低速不能判定为非骑行**。落进 10~20 km/h 重叠区一律保守判骑行（误判会让用户骑行里程凭空消失，比统计偏大严重得多），灰区只列进复核弹窗且默认不勾选。
  - **分析类页面取数必须走 `listCyclingSummaries(repository)`**（`features/activity/cyclingScope.ts`），不得直接 `listAllSummaries()`。**过滤必须发生在 `summariesScanKey()` 之前**：热力图/路线图/赛段/统计页的抽稀缓存以该指纹为键、缓存在 IndexedDB 跨会话存活，若先按全量算指纹再过滤，会永久命中「混了非骑行轨迹」的旧缓存且刷新不自愈。不做过滤的例外仅两处：骑行记录列表页（数据管理入口）与导出/清空/补算等维护任务。
  - **不得静默改写用户数据的类型**：导入期按上面判据定稿（属新数据初始化，并在导入汇总 `nonCyclingCounts` 中告知）；存量修正是**只读检测 → 用户确认 → 才写入**（`features/activity/suspectTypes.ts` + `BatchActivityTypeDialog`），理由是静默改历史统计会让用户看到「上次 3000km 今天 2400km」却无操作痕迹。
  - 作者快照 `scripts/buildAuthorData.ts` 对非骑行 **fail-fast**（快照是所有访客的首屏，混入即污染且访客无从察觉）。设置项 `data.includeOtherSports`（默认关）可让分析页计入全部运动，切换后整页刷新一次（运行时镜像在 `cyclingScope`，模块级变量，各页面挂载时取数）。

- **⚠️ 录屏技能会临时改源码，提交前必须扫「补丁残留」（v2.59.0 记，已真实污染过一次）**：`.workbuddy/skills/replay-video-record` 录制前替换 `src/map/TrackReplay.tsx` 的 `SPEED_OPTIONS` 与 `followCursor`（留下 `[replay-video-record]` 标记），还原靠**进程内快照**，被 Ctrl+C 硬杀时不执行。曾因此在 main 上留下 `SPEED_OPTIONS = [1, 8, 32, 600]` 与注释掉的 `followCursor`——症状是本地测试全绿、直到下次拉取才冒出来（找不到「128×」按钮 + lint 报 `followCursor` 未使用）。**提交前自查**：`grep -rn "\[replay-video-record\]" src/ tests/` 为空（扫标记本身，别扫技能名——文档里描述这个坑的文字会误报）且 `SPEED_OPTIONS` 为 5 档 `[1, 8, 32, 64, 128]`；清理用 `node .workbuddy/skills/replay-video-record/scripts/record-replay.mjs --restore-only`（脚本每次启动也会先自愈）。

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
| UI-9 | 骑行记录页筛选栏改版 | 高 | ✅ 已实现 | 文件清单：`ActivityFilters.tsx`（重排）、`CustomFilterDialog.tsx`（新增，替代删除的 `CustomFilterPanel.tsx`）、`ActivityPagination.tsx`（每页条数）、`activityFilterStore.ts`（+year/+pageSize，清理 activityType/minDistanceKm/minElevationGain/minAvgPower）、`activityRepository.ts`（+year 查询选项）、`activity-page.css`。要点：①第一行左起年份→月份→搜索（月份选项按年份过滤，下拉恒降序「最新在前」），右侧操作组从右到左为批量重命名/轨迹纠偏/重置，自定义筛选在重置左侧；②移除类型筛选与距离/爬升/功率三个数值输入；③自定义筛选弹窗 = 预设列表（勾选/名称/自动生成说明/修改/删除）+ 新建/修改条件行（字段/比较/值/至），多选套用为条件 AND 叠加，已生效条件以 chips 展示在工具栏；④轨迹纠偏口径改为「当前筛选命中的全部记录」（原需逐条勾选），作者快照源仍禁用；⑤分页 = 总条数 + 每页条数下拉（10/20/50/100/200/500）+ 页码省略号，pageSize 持久化。测试：activitiesPage 改版（27 例含年份筛选/弹窗预设增删/每页条数）+ activityRepository 年份筛选新增，全量 1132/1132 + lint/build 绿 | 1 commit |
| UI-10 | 骑行记录筛选栏二次优化（用户 7 点需求，原型评审后实施） | 高 | ✅ 已实现 | 文件清单：`ActivityFilters.tsx`（+预设下拉/自定义筛选组）、`ActivitiesPage.tsx`（排序条精简、`handleApplyPreset`）、`CustomFilterDialog.tsx`（默认名/初始条件/行内操作列）、`activity-page.css`、`changelogData.ts`。要点：①去掉「排序：日期 降序」状态文案，仅排序偏离默认（日期降序）时显示「重置排序」按钮，表头点击排序保留；②弹窗名称留空保存自动按条件生成默认名（`defaultPresetName`），去掉「请输入名称」报错，撞名仍确认覆盖；③条件行每行操作列放等大等高「添加/删除」按钮（info/danger 描边，`.filter-dialog__row-btn`），表头不再放添加；④「自定义筛选」按钮左侧新增预设下拉（`选择预设` aria-label，无预设时禁用显示「暂无预设」），选中即套用该预设条件（与弹窗多选同口径：条件并集 AND）；⑤预设下拉 + 自定义筛选按钮 + chips 与搜索输入框同一行（`.activity-filters__custom-group/-row`，工具栏 `align-items: flex-end` 对齐）；⑥按钮语义色：自定义筛选/预设下拉/chips = info 蓝、轨迹纠偏 = warning 橙、重置/重置排序 = 中性灰、批量重命名 = 品牌绿实底不变（符合「品牌绿仅主按钮」规范）；⑦新建预设预填初始条件「距离 > 20 km」「平均速度 > 20 km/h」（`defaultRows()`，可删改）。测试：activitiesPage 29 例（新增默认名/预设下拉套用/重置排序显隐 3 例，改造新建用例适配预填；预设名断言限定 `td` 选择器避免与下拉 option 冲突），全量 1175/1175 + lint/build 绿 | 1 commit |
| UI-8 | 统计页叙事化（P1 页面结构建议） | 低（收益大但改动大） | ✅ 已实现 | 统计页按三个用户问题分章重排：①「我进步了吗？」= 范围指标卡 + 个人纪录；②「我骑什么路线？」= 路线分析；③「我用什么设备？」= 设备统计 + 自行车统计。每章一句导语（`statistics-chapter` 样式，语义 token）；五个子组件标题 h2 → h3（类名样式不变），章节标题升为 h2；区块顺序从「指标/纪录/设备/自行车/路线」调整为「进步/路线/设备」。子区块 aria-label 不变，既有测试零破坏；新增分章顺序断言用例，全量 839/839 + lint/build 绿 | 1 commit |
| UI-11 | 全站反馈窗口（纯飞书表单方案） | 中 | ✅ 已实现 | 文件清单：`src/components/FeedbackButton.tsx`（右下角常驻悬浮按钮，复用 CSS 变量、深浅自适应）、`FeedbackModal.tsx`（弹窗展示飞书表单二维码 + 打开链接按钮，Esc/遮罩关闭，role=dialog）、`feedback.css`、`src/config.ts`（`FEEDBACK_FORM_URL` / `FEEDBACK_QR_PATH` 常量，后者用 `import.meta.env.BASE_URL` 拼接以适配 `/cycling-analyzer/` 子路径部署）、`public/feedback-form-qr.png`（飞书表单二维码）、`vite.config.ts`（`includeAssets` 加入二维码以加入 PWA 预缓存）。方案：用户点击悬浮按钮 → 弹窗展示二维码与「打开飞书表单」按钮 → 扫码或点击即可填写「客户需求收集表」，无需 GitHub 账户、国内直连可达；反馈汇总到飞书后台后再整理进 GitHub Issues。测试：`FeedbackModal.test.tsx` 3 例（展示二维码与按钮 / 点击打开飞书表单链接 / 关闭回调），全量绿 | 版本 2.51.0 → 2.51.1（[BF] 修复 GitHub Pages 子路径下二维码 404） |

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
