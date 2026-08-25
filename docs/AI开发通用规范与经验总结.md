# AI 协作开发通用规范与经验总结（实战版）

> **来源**：四个完全由 AI Agent 开发的项目——`cycling-analyzer`（React 骑行数据分析）、
> `kudo`（Java Kudu 备份工具）、`dumpmgr`（Spring Boot 中间件）、`life-simulator`（React 游戏），
> 加全局配置层（`.claude` / `.codex`）。工具覆盖 Claude Code / Codex / pi / opencode。
>
> **规模佐证**：合计 620 commits、900+ 单测、版本迭代 1.0→2.18，
> 全程无人工写码，规范全部从实践中反向沉淀。
> 每条规范都标注真实出处；❌ 是真踩过的坑，✅ 是验证有效的做法。

---

## 0. 这份文档怎么用

- **开新项目**：照第 13 章清单从上往下建，一天搭完基础设施。
- **老项目体检**：拿第 14 章自检清单逐项过，缺什么补什么。
- **踩坑时**：先查第 5 章事故库，没有再排查；修完按第 1 章的方法沉淀回文档。
- **分享给别人**：✅ 本文档**自包含**——正文引用的所有模板与本地文件已全文收录在
  附录 A~H（CLAUDE.md 模板与完整实例、PROGRESS/spec/plan/SDD 台账模板、hooks 脚本、
  自定义 Skill），对方拿到这一个 md 文件即可独立使用，无需访问任何原始仓库。

---

## 1. 底层逻辑：三条真实事故还原

规范不是想出来的，是事故倒逼出来的。三个代表性故事：

### 事故 1：上下文断了，进度全丢 → §0 登记制

早期任务做到一半会话断掉（上下文满/手动停止），新会话不知道做到哪，
只能重新读代码猜进度。于是 cycling-analyzer 的 PROGRESS.md 出现 §0 表：

```markdown
| 状态 | 任务 | 进度 | 下一步 |
|---|---|---|---|
| 🔄 运行中 | 赛段 GPX 导入卡死修复 | 方案已与用户确认，拆 5 个子任务：
  T1 trackMatchesPath 三层降复杂度；T2 缓存路径校验；T3 Web Worker 化… | 等用户指令开始 T1 |
```

**规则**：开始前登记、每步更新、完成移出。任何 Agent 接手先读 §0。
后来所有项目的 `.superpowers/sdd/progress.md` 都是同一思想的变体（见第 4 章）。

### 事故 2：提交风格悄悄回退 → 正反例一起写进文档

cycling-analyzer 曾把全部功能点用「+」串进一行超长 Subject：

```text
❌ 8a0654f（真实反例）：
[NF] 赛段卡片展开完整成绩排行列表（排名/日期/用时链接详情）+ 表现趋势页新增有氧效率月度趋
势区块（AE=平均速度÷平均心率，无功率计场景，无心率数据隐藏），版本 2.12.0
```

之后专门一次提交（`7de1739`「提交规范明确化」）在 CLAUDE.md 里同时写下正例与反例，
并注明「勿回退到单行长 Subject 风格」。**教训：只写规则不够，要连反例一起存档，
否则后续 Agent 会凭训练数据里的习惯回退。**

### 事故 3：有意的设计取舍被当成 bug「修掉」→ 合规例外表

kudo 的全局编码规范禁止内部代码 `catch(Exception)`，但备份工具在元数据捕获等
辅助路径上有 20 处故意这么写（失败返回 null 降级继续，比中止备份更安全）。
为防止后续 Agent「好心修复」，CLAUDE.md 建了合规状态表并单独成节解释：

```markdown
| catch(Exception) 使用 | ⚠️ | 见下方说明 |
#### catch(Exception) 设计取舍
这些方法的共同特点：非主流程辅助路径，失败后降级（返回 null/默认值），
不影响主流程数据安全性。这是备份工具「尽力而为」原则的体现。
```

**教训：凡是有意违反规范的地方，必须当场写下理由，否则必被回退。**

---

## 2. 指令文件：怎么写才不空泛

### 2.1 三层结构

```
~/.claude/CLAUDE.md ≡ ~/.codex/AGENTS.md   全局：只有跨项目规则（如 CodeGraph 用法）
        └── 项目 CLAUDE.md                  详细版，Agent 第一入口
              └── 项目 AGENTS.md            精简版，给 Codex/pi/opencode
```

### 2.2 CLAUDE.md 标准骨架与篇幅基准

| 章节 | 写什么 | 篇幅 |
|---|---|---|
| 项目概述 | 一段话：是什么/技术栈/部署形态/核心约束 | ≤5 行 |
| 常用命令 | dev/test/lint/build + **单文件测试** + 数据再生成脚本 | 一个代码块 |
| 架构 | ASCII 分层图 + 编号设计决策列表（持续追加） | 主体 |
| 测试约定 | 框架/fixture 位置/可测性模式/私有数据红线 | ≤10 行 |
| 代码与提交规范 | 语言约定/前缀表/**正例+反例全文** | ≤30 行 |
| 关键坑 | 按模块分组的血泪清单（见第 5 章） | 持续追加 |
| scope | AI 不负责的边界 | 1~2 行 |

四个项目的 CLAUDE.md 从 50 行到 255 行不等，共同点：
**每句话都是可执行的指令或可查证的事实，没有愿景和口号**。

### 2.3 五个「一句话解决反复纠纷」的真实片段（值得抄）

```text
① dumpmgr·验证成本：   「写完代码后只需 mvn compile test-compile 确认编译通过即可，
                        不要执行 mvn test。除非用户明确要求运行测试。」
   —— 一行话终结了「每次改动要不要跑全量测试」的拉扯。

② cycling·缺失值语义： 「缺失字段 = undefined ≠ 0，UI 显示 —」（规格 §25）
   —— 统计页曾出现「最高功率 0 W」，作者源根本没功率计，0 是伪造的。

③ dumpmgr·scope 边界：「AI only checks Java code and SRC directories,
                        not Python or native_wrapper directories」

④ life-sim·生成物保护：「所有事件改动都改 chiled.json，不手改 events.json」
   —— events.json 是转换器产物，手改下次 build 就被冲掉。

⑤ kudo·恢复安全底线：  「绝不使用当前时间戳冒充 watermark（会导致变更永久丢失）」
```

反面教材（不要这样写）：「代码要保持简洁清晰」「注意性能优化」「遵循最佳实践」——
不可执行、不可判定的句子等于没写。

---

## 3. 任务工作流：spec → plan → task → DoD

大功能四步走（superpowers 模式，四个项目通用）：

1. **设计文档** `docs/superpowers/specs/YYYY-MM-DD-xxx-design.md`：
   背景/目标/**非目标**/方案对比；分歧给用户选择题，结论标注「已批准」。
2. **实现计划** `plans/YYYY-MM-DD-xxx.md`：按依赖拆 Task，头部置顶 Global Constraints
   （把注释语言、提交格式、只读边界等全局规范**复制进计划文件**，执行 Agent 不用跳读）；
   每个 Task 列 Create/Modify/Test 文件、Produces/Consumes 接口签名、checkbox 步骤。
3. **执行**：小任务直接做；大任务走 SDD 子代理（第 4 章）。
4. **收尾 DoD**（固定顺序）：`lint && test && build` 三绿 → 更新 PROGRESS.md →
   升 minor 版本 + changelog 头部追加 → 规范 commit → push 后确认 CI 绿。

**中断恢复**靠 PROGRESS.md §0 登记制（第 1 章事故 1）。

---

## 4. SDD 子代理台账（大任务拆子代理时的标准动作）

```text
.superpowers/sdd/<plan-name>/
├── progress.md        台账：BASE 提交号、分支、各 Task 状态、延期瑕疵、交接说明
├── task-N-brief.md    任务书：Files 分类清单 / Interfaces 签名 / TDD checkbox 步骤
├── task-N-report.md   报告：Step 表格逐步打勾 + 红→绿两轮测试输出 + commit hash
└── review-A..B.diff   审查 diff 存档
```

三个关键实践（均出自 life-simulator / dumpmgr 真实文件）：

- **brief 写到「逐字转录」级**：测试代码直接给全文，子代理只负责照抄→跑红→实现→跑绿。
  Interfaces 标明消费方（如 `Produces（Task 4 消费）: mergeFragments(base, fragments)`）。
- **report 必须附两轮输出**：第一轮 `Error [ERR_MODULE_NOT_FOUND]`（预期红），
  第二轮 `19/19 PASS`——证明真的走了 TDD，不是补的测试。
- **progress.md 的交接说明**支持中途换模型/换会话：

```markdown
Task 3: 已派发 5 个生成子代理后被用户叫停（换模型执行），agents 仅在读文档阶段被终止
Task 3: 交接说明——新会话按计划 docs/superpowers/plans/2026-07-31-event-rebalance.md
        的 Task 3 重新派发即可；brief 在 .superpowers/sdd/.../task-3-brief.md
Task 1: minor (deferred): checkDistribution 不检查完全缺失的年龄——T4 合并后需另做检查
```

`minor (deferred)` 记账不阻塞——小瑕疵留痕，避免「当时发现了、后来忘了」。

---

## 5. 踩坑知识库：完整事故链

格式统一为 **现象 → 根因 → 修复 → 教训**。这些都是真发生过的：

### FIT / 解析类

1. FIT 文件校验永远返回 false → **根因**：`isFitFile/checkFitIntegrity` 在 `read()`
   之后调用，read 已消费 stream → **修复**：校验必须在 read 前 → 沉淀于 CLAUDE.md 架构节首条。
2. GPX 心率/踏频扩展字段读不到 → **根因**：带命名空间前缀的标签（TrackPointExtension 下）
   `getElementsByTagName` 查不到 → **修复**：`getElementsByTagNameNS` 按局部名匹配。

### 浏览器 API 类

3. 选完文件页面无反应 → **根因**：FileList 是 live 引用，`event.target.value=''`
   重置时清掉了已保存的引用 → **修复**：先 `Array.from()` 快照再重置。
4. Recharts 图表在测试里不渲染 → **根因**：jsdom 没有 layout，
   `getBoundingClientRect` 返回全 0 且**必须 mock 含 left/top 字段**。

### 第三方库升级类

5. recharts 升 v3 后图表悬停联动失效 → **根因**：`activeTooltipIndex` 从 number 变
   string，`typeof === 'number'` 判断失效 → **修复**：封装
   `activeTooltipIndexToNumber()` 归一化共用 → **教训**：升级图表库后悬停交互要回归测试。

### 存储类

6. 加个字段就要升 DB 版本？→ 不用：**Dexie 非索引字段增删免升 DB_VERSION**，
   改索引列才需要。省掉大量无谓迁移代码。

### 性能类

7. 导入赛段 GPX 后页面卡死 35 秒 → **根因**：路径校验 O(N×M) 主线程暴力计算 +
   盘山折返反复撞终点圆重复校验 + 批量卡片多 Leaflet 实例 → **修复组合拳**：
   包围盒预筛 + 抽稀≤200 点 + 中位数提前退出 + 以穿越段为 key 缓存结果 + Web Worker 化
   （jsdom 无 Worker 时同步回退）→ **方法论**：性能问题拆「降复杂度/缓存/移出主线程」三层。

### 环境/工具链类

8. bash 下 vitest 全量 0 用例执行 → **根因**：bash 宿主进程注入污染 runner 上下文，
   与代码无关 → **修复**：换 PowerShell 通道跑 → **教训**：测试异常先排除宿主环境。
9. README 截图瓦片全空白 → **根因**：截图脚本没走代理，外网瓦片加载不出 →
   **修复**：脚本加 HTTPS_PROXY 支持 + 瓦片页避开 networkidle 等待策略。

### 数据正确性类（备份工具特有，思想通用）

10. diffScan 空窗口重复扫描风险 → **根因**：rowCount=0 时跳过水位线更新，
    下次重复扫同一窗口 → **修复**：空结果也要推进水位线。
11. Gson 反序列化 Object 字段类型漂移 → **修复**：`ToNumberPolicy.LONG_OR_DOUBLE`
    + 恢复端窄类型强制转换（INT8→Byte…）。
12. DELETE 行被恢复复活 → **修复**：处理任何行之前先校验 Parquet 含 `_kudu_op` 列，
    strict 模式中止、宽松模式跳过整个文件且不留 mutation。

---

## 6. Git 提交规范：全文对照

### ✅ 好例子（84d37a4 全文）

```text
[IM] git hook 自动配置：npm install 时设置 hooksPath 并补齐可执行位

- package.json 新增 prepare 脚本（git config core.hooksPath .githooks）：
  clone 后 npm install 即自动启用 post-commit 钩子，不再依赖手动配置
- .githooks/post-commit 补充可执行位（100644 → 100755），兼容 Linux/CI 环境
```

Subject 一句话；细节全在 body bullet；测试/版本号进 body 不进标题。

### ❌ 反例（8a0654f，已废弃风格）

见第 1 章事故 2——功能点用「+」串成一行超长 Subject 还带版本号尾巴。

### 规则要点

- 前缀 `[NF]`新功能 `[BF]`缺陷 `[IM]`改进 `[CU]`杂务（kudo 另有 `[DOC]`）；
  中文 Subject；**无 AI 署名**；身份固定在项目 git config
- 一次提交只含一件事；每个任务单独 commit（方便进度对账和回滚）
- 发布：每组功能 push 前升 minor（构建注入显示）；changelog 文件倒序维护头部追加

### 企业版增量（dumpmgr）

| 维度 | 做法 |
|---|---|
| type 扩展 | `SC`第三方源码(注来源版本)/`RF`重构/`Doc`/`OT`构建工具 |
| 关联单号 | NF 带禅道任务号，BF 带 BugZilla bug 号（subject 直接以号开头） |
| 分支模型 | master / feature/9.x 主干 / feature·bugfix·hotfix·release / oem / private/<user>/ |
| 过程提交 | CU 类个人分支过程提交，merge request 时压缩为 NF/BF/IM |

---

## 7. 测试策略：分级 + 数字说话

- **三级隔离**：纯单测（无外部依赖，日常跑）→ 集成测试（`@Tag("integration")` 显式标注，
  `-Dgroups='!integration'` 排除）→ E2E（Playwright 本地跑不进 CI）。
  kudo 的集成测试需要 Kudu 集群 + Kerberos，靠 tag 与单测完全隔离。
- **DB 测试模式**：fake-indexeddb 全局注册 + 真 Dexie 实例注入——mock 掉的是浏览器
  不是被测库。
- **TDD 进任务书**：brief 给失败测试全文，report 附红绿两轮输出（见第 4 章）。
- **非常规测试手段**（life-simulator）：500 局随机模拟审计数值平衡（归零率/享年分布）、
  事件密度统计看板、flag 生产/消费配对校验——**数据驱动的产品用数据工具验收**。
- **规模参考**：cycling-analyzer 896 用例约 40s 全量；life-simulator 引擎 184 + UI 119 +
  数据工具 34；kudo 重构期 72 个单测零回归兜底 9 个重构提交。
- **开发期专用测试**用 `@Tag("dev")` 标记出包排除，不删代码。

---

## 8. 安全与隐私红线（含真实处置事件）

1. 私有数据目录 gitignored + CLAUDE.md 红线章节双保险：
   「private-fixtures/ 为用户真实骑行数据，严禁提交或引用进测试」。
2. **真实事件**：life-simulator 曾把 Cloudflare Worker 地址硬编码进仓库，
   处置 = 改环境变量注入（VITE_API_BASE 默认置空）+ **重写 git 历史**抹除痕迹 +
   CI 同时读 vars 和 secrets。
3. 高危依赖漏洞当天修：nanoid 3.3.16→3.3.18 单独 commit。
4. 隐私政策显性化：PRIVACY.md + LICENSE 补齐并在 README 链接；
   「本地解析不上传」写进产品首屏文案而不只是 README。
5. 安全待办清单化：security-backlog.md 按高/中/低记录（Turnstile 人机验证、
   KV 写配额限流、npm audit 门禁……），做完划掉，不指望记性。

---

## 9. Code Review 资产化（kudo 最佳实践）

review 清单绑定领域不变量而非泛泛风格。真实样例行：

| # | 检查点 | 文件 | 关键代码 | 风险说明 |
|---|---|---|---|---|
| 4 | DELETE 行标记正确性 | KuduVersionAdapter.java | diffScan() L136-142 | 最高风险点之一：DELETE 被误标 INSERT 会导致恢复后已删除数据复活 |

结构要点：开头画数据流图（理解流才能判断错）→ P0 致命/P1 严重/P2 关注分级 →
并发安全/故障恢复/测试覆盖缺口专章 → 配套 guide.md 给出「为什么」。
另外：外部评审报告 + 自动截图实测（capture-screenshots.mjs 截 8 页）交叉核实后再立项，
逐项标「已完成勿重做/半成品/真问题」。

---

## 10. 自动化 Hooks（抄作业区）

| 钩子 | 内容 | 效果 |
|---|---|---|
| package.json → prepare | git config core.hooksPath .githooks | clone + npm install 即全自动启用 |
| pre-commit | mvn test（dumpmgr） | 测试失败阻止提交；注释里写明 --no-verify 逃生门 |
| post-commit | 存在 .codegraph/ 才 codegraph sync | 索引自动同步 |
| Notification/Stop hook | BurntToast Windows 弹窗 | 需要操作/任务完成不用盯屏 |
| codex rules | 手动 allow 过的高频命令固化 prefix_rule | 审批策略越积越顺 |

CI 侧：构建产物 gitignored 由 CI 重建；快照任一样例解析失败即 fail-fast，
坏数据上不了线。

---

## 11. 多工具协作与交接

- CLAUDE.md 与 AGENTS.md **语义一致**，改规范两处同步；所有工具共享同一份
  PROGRESS.md 作为唯一事实来源。
- 中途换模型/换会话：ledger 写交接说明（计划位置 + brief 位置 + 已完成状态 + 注意事项），
  新会话零成本接手（真实原文见第 4 章）。
- 方案分歧给用户选择题，批准后写入 spec 标「已批准」，后续 Agent 不再重新讨论。
- 全局层：分档模型映射控成本（轻活便宜模型）；MCP 服务各工具共享同一套
  （codegraph/image-view/node_repl）。

---

## 12. 效果实证

| 项目 | commits | 测试 | 特色产出 |
|---|---|---|---|
| cycling-analyzer | 167 | 896 | 双数据源架构、§0 登记制、changelog 页自动化 |
| life-simulator | 216 | 337+ | 752 事件数据管道、SDD 并行子代理、平衡模拟器 |
| dumpmgr | 129 | 单测门禁 | 企业规范落地、pre-commit 门禁、Python 伴生工具链 |
| kudo | 108 | 72+ | 28 条设计决策、review 资产、概设 V1.x 演进 |

这套流程的可复制证据：四个不同语言/形态的项目（前端 SPA×2、Java 后端×2），
同一套方法论零适配成本落地。

---

## 13. 新项目起步清单（第一天照做）

```text
□ git init；.gitignore 收录：私有数据目录、构建产物、本地配置
□ 固定提交身份（项目级 git config user.name/email）
□ CLAUDE.md 骨架（概述/命令/架构三节起步，随开发长肉）
□ 多工具就加 AGENTS.md 精简版
□ docs/PROGRESS.md（含 §0 登记表 + 维护规则声明）
□ docs/规格说明.md（需求编号章节，供「规格 §N」式引用）
□ 测试框架 + setup + fixtures 目录（公开样例与私有数据物理分离）
□ lint/format 配置
□ hooks 目录 + prepare 自动启用 + pre-commit/post-commit
□ CI：lint → test → build → deploy，fail-fast
□ 第一个功能走完 spec→plan→task→DoD 全流程（把流程本身跑通）
```

## 14. 存量项目自检清单

```text
□ CLAUDE.md 里有没有至少一条「反例」？（防风格回退）
□ 有意违反规范的每一处，理由写下来了吗？
□ 会话现在断了，下一个 Agent 能否只靠仓库内文档接手？
□ 生成物文件是否明确标注「勿手改」？
□ 最近一次踩坑，沉淀进文档了吗，还是只留在聊天记录里？
□ 测试有没有分级？日常迭代会不会被迫跑全量？
□ 私有数据/密钥的边界，新人（和新 Agent）一眼能看懂吗？
□ review 清单绑定领域不变量了吗，还是通用的风格套话？
```

---

# 附录：模板与真实文件全文（本文档自包含）

> 以下 A~F 为可直接抄改的空白模板，G~H 为真实文件原文。
> 拿到本文档即可落地全套流程，无需访问任何原始仓库。

---

## 附录 A：CLAUDE.md 通用模板

> 放在仓库根目录。`<...>` 为填写指引，建好后删除。

````markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

<一段话：这是什么 + 技术栈 + 部署形态 + 最核心的一条产品/数据约束>

## 常用命令

```bash
npm run dev            # 本地开发
npm run test           # 全量测试（N 用例约 Ns）
npx vitest run <file>  # 单文件测试
npm run lint && npm run build   # 提交前必须全绿
node script/generate-data.mjs   # 数据再生成（如有数据管道）
```

<验证规范一行话，例：「快速迭代只需 compile 通过；收尾才跑全量 lint+test+build。
除非用户明确要求，不要主动跑全量测试。」>

## 架构

### 分层与硬边界

```
LayerA → LayerB → LayerC → Storage → UI
```

- <X 层禁止直接调用 Y；UI 只依赖领域模型与接口>
- <领域模型唯一契约：单位固定；缺失字段 = undefined ≠ 0，UI 显示 — 不伪造>
- <其他边界约束，逐条列出>

### 关键设计决策（持续追加编号）

1. **决策名**：一句话结论。为什么这么定。废弃了什么旧方案。
2. ...

## 测试约定

- 框架与环境；DB 测试用内存实现 + 真实客户端注入
- fixture 目录位置与再生成脚本
- 可测性模式：纯函数优先 / 页面测试包裹路由 / 数据加载支持注入
- **`private-fixtures/` 为用户真实数据，gitignored，严禁提交或引用进测试**

## 代码与提交规范

- 注释中文；日志/异常消息英文；无魔法值；<语言特有规范>
- 提交前缀 `[NF]`新功能 `[BF]`缺陷 `[IM]`改进 `[CU]`杂务 + 中文 Subject；**无 AI 署名**
- Subject 一句话概括；细节放正文 `- ` bullet list（改了什么/关键点/测试情况/版本号）

✅ 正例：
[NF] 详情页报告化：一句话总结 + 核心指标精选 + 更多指标折叠

- 新增 src/features/activity/rideSummary.ts …
- 测试 14 新增，全量 830/830 + lint/build 绿
- 版本 2.9.0 → 2.10.0

❌ 反例（已废弃，勿回退）：把全部功能点用「+」串进一行长 Subject 并以「版本 X.Y.Z」结尾

- 提交身份固定 `<name> <email>`（项目级 git config 已设，勿改）
- 改动前先读 docs/PROGRESS.md 确认现状；每完成一个功能先更新它再提交代码

## 关键坑

<按模块分组，每条 = 现象 → 根因 → 修复。示例格式：>
- **模块名·现象**：根因一句话 → 修复方案 → 教训一句

## scope

AI 只检查 <目录/语言>，不处理 <排除范围>。
````

---

## 附录 B：AGENTS.md 精简版模板（给 Codex / pi / opencode 等）

> 与 CLAUDE.md 语义一致但压缩到 ~50 行；两份文件改规范时同步更新。

````markdown
# AGENTS.md

<一段话项目简介>

## 必读文档（动手前先读）

- `CLAUDE.md` — 架构分层、设计决策、代码/提交规范
- `docs/PROGRESS.md` — 功能状态清单；**§0 是进行中任务清单，中断恢复必读；
  每开始任务先登记、完成后移出**
- `docs/<规格说明>.md` — 产品规格原文

## 命令

```bash
<dev / 单文件测试 / 全量测试 / lint+build / 数据再生成 / e2e>
```

## 架构硬边界

```
<分层管线图>
```

- <禁止事项 2~4 条，含缺失值语义等核心契约>

## 关键坑

- <5~8 条最致命的坑，一条一行>

## 提交规范

- 前缀 `[NF]/[BF]/[IM]/[CU]` + 中文 Subject；**无 AI 署名**
- 提交身份固定 `<name> <email>`（项目 git config 已设，勿改）
- 先同步更新 `docs/PROGRESS.md` 再提交
- **版本策略**：<何时升 minor 版本、changelog 怎么维护>
````

---

## 附录 C：docs/PROGRESS.md 模板（含 §0 登记表）

```markdown
# 项目进度与功能状态

> 本文档记录功能实现状态与架构约定，供后续开发（含 AI agent）继续工作参考。
> **维护规则**：每完成一个功能/阶段必须同步更新本文档（状态与文件清单），再提交代码；
> 进行中的任务标注「🔄 运行中」并注明负责 agent。
> **每个任务开始前先登记到 §0，完成后移出**（防中断丢失进度）。

---

## 0. 进行中任务清单（中断恢复必读）

> 用途：任务中途因上下文满/费用不足/手动停止而中断时，agent 先读本节定位进度，
> 避免重复工作或遗漏。

| 状态 | 任务 | 进度 | 下一步 |
|---|---|---|---|
| 🔄 运行中 | **任务名**（用户反馈原话/需求来源） | 子任务拆解 T1~Tn + 各自当前状态 | 明确的下一个动作 |
| ✅ 已提交 | **任务名** | 关键实现摘要 + 测试结果 + commit 号 | push / 发布 |

## 1. 已完成内容归档
<明细多了迁到 docs/archive/，这里只留索引>

## N. 架构与接口约定（agent 工作须知）
<分层边界 / 测试约定 / 代码规范速查 / 常用命令——与 CLAUDE.md 保持一致>
```

---

## 附录 D：spec 设计文档 + plan 实现计划模板

### D-1 设计文档（docs/superpowers/specs/YYYY-MM-DD-xxx-design.md）

```markdown
# XXX 设计文档

> 日期：YYYY-MM-DD。状态：已批准（用户确认方案 A 与整体设计）。
> 需求来源：<用户原话/评审结论>。

## 1. 背景与目标
目标：
- <可验收的目标句>

非目标：
- <明确不做的事，防止范围蔓延>

## 2. 总体架构
<ASCII 图 + 组件职责>

## 3. 方案对比
| 方案 | 优点 | 缺点 | 结论 |
（给用户选择题，批准后标注「已批准」——后续 Agent 不再重新讨论）

## 4. 数据模型 / 接口定义
```

### D-2 实现计划（docs/superpowers/plans/YYYY-MM-DD-xxx.md）

````markdown
# XXX 实现计划

> For agentic workers: REQUIRED SUB-SKILL: subagent-driven-development
> (recommended) or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** <一句话>
**Architecture:** <一句话>
**Tech Stack:** ...
**Spec:** `docs/superpowers/specs/xxx-design.md`

## Global Constraints
<把全局规范复制到这里置顶，执行 agent 无需跳读：>
- 注释中文；日志/异常消息英文；React 组件 function 声明；`@/` 别名导入
- 缺失字段 = undefined ≠ 0，UI 显示 —（不伪造数据）
- 写操作永远只进本地存储；<只读源> 严格只读
- 每个 Task 结束跑 test 与 lint，全绿才提交
- 提交前缀 [NF]/[IM] + 中文 Subject；无 AI 署名；身份已固定勿改
- private-fixtures/ 严禁提交

### Task 1: <名称>

**Files:**
- Create: `path/to/new.ts`
- Modify: `path/to/existing.ts`
- Test: `tests/xxx.test.ts`

**Interfaces:**
- Produces（Task 2 消费）: `fn(input): Output`
- Consumed by: Task 2 快照脚本

- [ ] **Step 1: 写失败的测试**（附测试代码全文，供子代理逐字转录）
- [ ] **Step 2: 实现**
- [ ] **Step 3: 重跑测试转绿 + lint + 提交**
````

---

## 附录 E：SDD 子代理台账三件套模板

目录：`.superpowers/sdd/<plan-name>/`（progress.md + task-N-brief/report + review diff）

### E-1 progress.md（台账）

```markdown
# SDD ledger — plan: docs/superpowers/plans/xxx.md

BASE（执行起点）: <commit-hash>
分支： master（项目惯例直接提交 master，用户已批准）

Task 1: complete (commits A..B, review clean)
Task 1: minor (deferred): <小瑕疵描述，不阻塞但记账>
Task 2: complete (commits B..C, review clean)
Task 3: 交接说明——新会话按计划 xxx 的 Task 3 重新派发即可；
        brief 在 .superpowers/sdd/<plan-name>/task-3-brief.md
Task 3: 新会话已重新并行派发 N 个生成子代理；派发前控制器确认：<前置校验项>
```

### E-2 task-N-brief.md（任务书要点）

```markdown
### Task N: <名称>

**Files:**
- Create / Modify / Test: <精确路径列表>

**Interfaces:**
- Produces（Task X 消费）: <函数签名>
- Consumed by: <谁用>

- [ ] **Step 1: 写失败的测试**（附测试代码全文，子代理逐字转录）
- [ ] **Step 2: 实现**
- [ ] **Step 3: 红→绿两轮输出贴进 report**
- [ ] **Step 4: 提交**
```

### E-3 task-N-report.md（执行报告要点）

```markdown
# Task N 报告

## Step 结果
| Step | 内容 | 结果 |
|---|---|---|
| 1 | 写失败测试 | 完成 |
| 2 | 确认失败 | 符合预期：<报错原文> |
| 3 | 实现 | 完成 |
| 4 | 重跑测试 | N pass / 0 fail |
| 5 | 提交 | <commit hash> |

## 两轮测试输出摘要
第一轮（实现前）：预期红 —— <错误原文>
第二轮（实现后）：N/N PASS
```

---

## 附录 F：Git Hooks 三件套全文

**package.json**（clone 后 npm install 即自动启用 hooks）：

```json
{
  "scripts": {
    "prepare": "git config core.hooksPath .githooks"
  }
}
```

**.githooks/post-commit**：

```bash
#!/bin/bash
# Post-commit hook: 每次提交后自动同步 CodeGraph 索引
if [ -d ".codegraph" ]; then
    codegraph sync
fi
```

**.githooks/pre-commit**（提交前强制测试门禁）：

```bash
#!/bin/bash
# Pre-commit hook: 提交前运行单元测试，测试失败则阻止提交
#
# 跳过方式（紧急情况）：
#   git commit --no-verify -m "..."
set -e
echo "Pre-commit: 运行单元测试..."
mvn test        # 或 npm test
echo "测试全部通过 ✅"
```

---

## 附录 G：自定义 Skill 实例——fix-report 全文

> 位置 `~/.claude/skills/fix-report/SKILL.md`。展示「个人经验资产化」的标准写法：
> 触发词 + 固定输出模板 + 要点 + 示例。

````markdown
---
name: fix-report
description: 用户要求生成修复说明、修复总结、问题处理说明时使用。适用于 bug 修复完
成后按固定四段式汇报：问题来源、问题原因、问题解决、已解决版本信息。
---

# 修复说明生成

## 触发

用户说"生成修复说明"、"写个修复总结"、"修复报告"等，且本次会话有刚完成的 bug 修复。

## 输出模板（严格四段式）

### 问题来源
在哪个场景/环境发现（生产/测试、哪个功能、哪个版本），附关键报错信息。

### 问题原因
根因一句话讲透：引入问题的改动、触发条件、为什么之前没暴露。

### 问题解决
修复方案（改了什么、怎么改的）+ 验证结果（编译、测试通过情况）。

### 已解决版本信息
提交号、分支、发布状态（已发布/待发布）。

## 要点

- **每段 1-3 句话，整体不超过 15 行**，用户偏好简洁，禁止写背景故事和分析过程
- 类名、方法名、提交号用英文，描述用中文
- 无版本信息时如实写"未发布，随下个版本生效"

## 示例

**问题来源**：生产环境文件控制台转储任务报 NPE，job 失败。

**问题原因**：`ClientsItem.instanceId` 由 `int` 改为 `Long` 后，文件场景前端不下发
`instance_id`，反序列化为 null，下游 `getPreFix(long,...)` 拆箱抛 NPE。

**问题解决**：`ClientsItem.getInstanceId()` 统一兜底 null → 0，一处改动覆盖全部拆箱点。
编译及 286 个单元测试全部通过。

**已解决版本**：提交 `b94fed9`（feature/9.x），未发布，随下个版本生效。
````

---

## 附录 H：完整真实实例——cycling-analyzer 双指令文件全文

> 展示「详细版 CLAUDE.md + 精简版 AGENTS.md」实际长什么样，可直接对照仿写。

### H-1 CLAUDE.md（68 行，详细版）

````markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

个人骑行数据分析网站（Strava Lite）：纯前端、数据完全本地化，FIT 文件在浏览器内解析，
数据存 IndexedDB，部署 GitHub Pages。产品规格与功能状态见 docs/PROGRESS.md（进行中任务
清单、未实现工作项、架构接口）；已完成功能的详细记录在 docs/archive/。

## 常用命令

npm run dev        # 本地开发（默认 5173 端口）
npm run test       # 全量测试（vitest run，610+ 用例）
npx vitest run tests/fit/decoder.test.ts   # 单文件测试
npm run lint       # ESLint（flat config）
npm run build      # tsc -b + vite build（产出 dist/）
node tests/fixtures/generate-samples.mjs   # 重新生成合成 FIT 测试样例

代码修改后执行 codegraph sync 同步索引。

## 架构

### 数据分层（硬边界，规格 §42）

FIT Decoder → Normalizer → Calculator → Storage Repository → UI

- src/fit/decoder：封装 @garmin/fitsdk。Stream 的 isFIT/checkIntegrity 必须在 read() 前
  调用（read 消费 stream 后误报 false）
- src/fit/normalizer：SDK 结构 → 领域模型（半周→十进制度、Date→Unix 秒）
- src/fit/calculator：统计计算（爬升=相邻正增量、平均速度=距离/时长）
- src/storage：Dexie 库 cycling-data（activities 摘要 / activity_records 逐点分表）
- src/features/*：业务功能域；src/pages、src/charts、src/map：页面与展示组件

约束：React 组件禁止直接调用 @garmin/fitsdk；UI 只依赖 src/types/activity.ts
领域模型与 repository 接口。

### 关键设计决策

- 领域模型是唯一跨层契约（src/types/activity.ts）：单位固定（米/m/s/bpm/rpm/W、
  Unix 秒、十进制度）；缺失字段 = undefined ≠ 0（规格 §25），UI 显示 —
- 摘要与逐点分表：activities 表不存 records；getById 返回摘要，getRecords 按需加载
- 去重指纹基于解压后内容（.fit 与 .fit.gz 同一活动判重一致）
- SPA 路由：main.tsx basename 生产 /cycling-analyzer、dev /
- 导入在 Web Worker 解析（jsdom 自动降级主线程），失败进台账可重试
- 双数据源：dataSourceStore 管理「作者的数据（只读）/ 我的数据（本地）」；
  组件统一经 useActivityRepository() 获取当前源的仓库；作者源下写操作 UI 一律隐藏
- 地图瓦片源自动降级：默认 OSM，连续 3 张失败自动降级高德瓦片并做 GCJ-02 纠偏

### 测试约定

- Vitest + jsdom；DB 测试用 fake-indexeddb + 真 Dexie 实例注入
- FIT 样例在 tests/fixtures/（公开样例 + 合成文件，不包含个人真实数据）
- 纯函数优先可测；页面测试用 MemoryRouter；数据加载支持注入
- private-fixtures/ 为用户真实骑行数据，gitignored，严禁提交或引用进测试

## 代码与提交规范

- 注释中文；日志/异常消息英文；@/ 别名导入；React 组件 function 声明
- 提交前缀 [NF]/[BF]/[IM]/[CU] + 中文 Subject，无 AI 署名
- 提交格式（参照 9d36a88，勿回退到单行长 Subject 风格）：
  - Subject 一句话概括，前缀后无冒号
  - 细节全部放正文 bullet list：改动文件与函数、关键实现点、测试情况、文档同步说明
  - 版本号变更写进正文 bullet，不追加在 Subject 尾部
  - 反例（已废弃）：把全部功能点用「+」串进一行长 Subject 并以「版本 X.Y.Z」结尾
- 提交身份固定 999bug <999bug@users.noreply.github.com>（项目级 git config，勿改）
- 改动前先读 docs/PROGRESS.md 确认现状，避免与进行中的任务冲突
- 每完成一个功能/阶段必须同步更新 docs/PROGRESS.md 再提交代码
````

### H-2 AGENTS.md（50 行，精简版骨架）

````markdown
# AGENTS.md

个人骑行数据分析网站（Strava Lite）：纯前端，FIT 在浏览器解析，数据存 IndexedDB，
GitHub Pages 部署，默认展示作者公开数据快照（只读）+ 访客本地数据双数据源。

## 必读文档（动手前先读）
- CLAUDE.md — 架构分层、设计决策、代码/提交规范
- docs/PROGRESS.md — 功能状态清单；§0 是进行中任务清单，中断恢复必读
- docs/<规格说明>.md — 产品规格原文（规格 §N 引用出处）

## 命令
<dev / 单文件测试 / 全量 / lint+build / 快照构建 / e2e / 样例再生成>

## 架构硬边界
FIT Decoder → Normalizer → Calculator → Storage Repository → UI
- React 组件禁止直接调用 @garmin/fitsdk；UI 只依赖领域模型与 repository 接口
- 组件不 new 仓库，统一经 useActivityRepository()；作者源只读，写操作 UI 按源隐藏
- 单位固定；缺失字段 = undefined ≠ 0，UI 显示 —

## 关键坑
- Stream 校验顺序：isFitFile/checkFitIntegrity 必须在 read() 前调用
- Dexie 非索引字段免升 DB_VERSION；改索引列才需要升版本
- activities 表只存摘要，逐点数据 getRecords 按需加载
- 测试：fake-indexeddb 全局注册 + 真 Dexie 注入；private-fixtures/ 严禁提交
- 页面测试用 MemoryRouter；mock getBoundingClientRect 让 Recharts 正常渲染

## 提交规范
- 前缀 [NF]/[BF]/[IM]/[CU] + 中文 Subject；无 AI 署名
- 提交身份固定（项目 git config 已设，勿改）
- 先同步更新 docs/PROGRESS.md 再提交；完成后 codegraph sync
- 版本策略：每次 push 一组功能提交前升一次 minor 版本；如已升过则跳过
````

---

*维护约定：本文是方法论总纲，各项目 CLAUDE.md 是具体实例；踩坑后先更新项目文档，
跨项目通用的再上升到这里。附录模板有改进时，优先改这里的空白版。*
