# 项目进度与功能状态

> 本文档记录骑行数据分析网站（cycling-analyzer）的功能实现状态、架构边界与接口约定，
> 供后续开发（含 AI agent）继续工作参考。最后更新：2026-09-09（[NF] 作者数据可见性策略：作者数据定位为空状态示例，导入后默认隐藏 + 设置页三档开关 + 一次性提示 + 深链「仅本次查看」兜底，版本 2.47.3 → 2.48.0）。
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
| 🔄 运行中 | **代码审计遗留项（按 docs/代码审计报告-2026-09-01.md 路线图）** | P0/P1 主体批次（RangeError/ErrorBoundary/Worker 超时/Dexie 防死锁/N+1/爬升口径/NP 满窗/重复代码收敛等 13 批）已全部提交，明细见 `docs/archive/PROGRESS-archive-2026-09.md` 对应行。**遗留四项**（推进前先核实，部分可能已被后续版本顺带修复，如 recharts 已于 2.22.0 拆出主包）：①P0 exportData 全量入内存（备份通道 OOM 风险）；②P1 3.6 首屏体积（recharts modulepreload）；③P1 3.2 activityRepository startsWith UTC 真 bug（待专项）；④P1 3.5 buildClimbs memo | 按审计报告逐项专项处理，每项单独 commit |
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
