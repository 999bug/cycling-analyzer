# AI 协作开发通用规范与经验总结

> **来源**：四个完整由 AI Agent 开发的项目实践提炼——
> `cycling-analyzer`（React 骑行数据分析）、`kudo`（Java Kudu 备份工具）、
> `dumpmgr`（Spring Boot 中间件）、`life-simulator`（React 文字游戏），
> 以及全局配置层（`.claude` / `.codex` / `.agents`）。
> 工具覆盖：Claude Code / Codex / pi / opencode。
>
> 本文是**通用版**：只收录跨项目反复验证有效的方法论，项目专属细节见各自仓库的
> `CLAUDE.md` / `docs/`。

---

## 1. 总原则（所有项目的底层逻辑）

1. **上下文会断，进度不能断**——一切方法论围绕这句话展开：
   会话会被上下文上限、费用、手动停止打断，所以进度必须落在文件里，而不是对话里。
2. **规范必须写在 Agent 的必读路径上**（CLAUDE.md 第一屏），口头约定等于不存在。
3. **每条规范背后都应该是一个真实踩过的坑**——踩坑后在文档里补一条，
   正例如「Stream 校验必须在 read() 之前」，反例如「回退到单行长 Subject」。
4. **文档与代码同步是铁律**：完成功能先更新文档再提交；定期归档瘦身保持文档可读。
5. **让 AI 做选择题，不做问答题**：方案分歧时给出对比选项让用户拍板，
   结论写入设计文档标注「已批准」，后续所有 Agent 都不再重新讨论。

---

## 2. 分层指令体系（全局 → 项目 → 工具）

```
~/.claude/CLAUDE.md  ~/.codex/AGENTS.md     ← 全局：跨项目通用规则（内容保持一致）
        └── 项目 CLAUDE.md                   ← 详细版：架构/决策/命令/坑
              └── 项目 AGENTS.md             ← 精简版：给非 Claude 工具（Codex/pi/opencode）
```

- **全局放通用规则，项目规范下沉到仓库**，两层互不重复；
  全局文件被工具自动改写时（如 CodeGraph 注入区块），用标记注释圈出托管区。
- CLAUDE.md 标准骨架（四个项目共同验证的结构）：

```markdown
# CLAUDE.md
## 项目概述          ← 一段话说清这是什么、技术栈、部署形态
## 常用命令          ← dev/test/lint/build + 单文件测试写法 + 数据再生成脚本
## 架构              ← ASCII 分层图 + 关键设计决策（编号列表，持续追加）
## 测试约定          ← 框架、fixture 位置、可测性模式
## 代码与提交规范     ← 语言约定、前缀表、正例反例
## 关键坑            ← 血泪经验，按模块分组
## scope            ← 明确 AI 不负责的边界
```

- **关键设计决策用编号列表沉淀在 CLAUDE.md**（kudo 积累了 28 条），每条 =
  决策一句话 + 为什么 + 废弃了什么旧方案。这比散在代码注释里可靠得多。
- **合规状态表 + 有意例外**（kudo 做法）：列出编码规范的逐项合规状态，
  对故意违反的规则单独成节解释取舍理由（如内部辅助路径允许 catch(Exception) 是
  「尽力而为降级」的有意设计）——防止后续 Agent 当 bug「修掉」。
- **scope 划界**（dumpmgr 做法）：明确告诉 AI 只检查哪些目录/语言，
  防止越界改动或浪费上下文。

---

## 3. 文档体系：动手前读什么、完成后写什么

| 文件 | 作用 | 时机 |
|---|---|---|
| 产品规格说明 | 需求原文，文档中「规格 §N」引用它 | 立项时写 |
| 设计文档 specs/（日期命名） | 方案对比、目标/非目标、用户批准结论 | 大功能动工前 |
| 实现计划 plans/（日期命名） | 按 Task 拆解：文件清单、接口签名、checkbox 步骤、代码骨架 | 设计批准后 |
| PROGRESS.md | 功能状态 + **§0 进行中任务清单** | 每个任务全程维护 |
| 专项清单 | security-backlog.md 等：已完成/按优先级待办 | 持续 |
| 归档 archive/ | 已完成明细迁出主文档 | 主文档过长时 |

**三条运行铁律**：

1. **§0 任务登记制**：每开始一个任务先登记（🔄 运行中 + 负责 agent +
   子任务拆解 + 下一步）；完成移出。中断后下一个 Agent 读 §0 即可无损接续。
2. **完成定义（DoD）固定**：`lint && test && build` 三绿 → 更新 PROGRESS.md →
   升版本/changelog → 规范格式 commit → push 后确认 CI 绿。
3. **文档瘦身归档**：已完成功能明细迁到 archive/，主文档保持一屏能读完结构。

---

## 4. SDD 子代理开发工作流（`.superpowers/sdd/`）

大任务拆给子代理执行时的完整台账模式（dumpmgr 与 life-simulator 均验证）：

```
.superpowers/sdd/<plan-name>/
├── progress.md        ← 台账：BASE 提交号、分支、每个 Task 状态
├── task-N-brief.md    ← 给子代理的任务书
├── task-N-report.md   ← 子代理的执行报告
└── review-A..B.diff   ← 审查用的 diff 存档
```

- **brief 要写到「逐字转录」级别**：Files（Create/Modify/Test 分类）、
  Interfaces（Produces/Consumes 签名，标明哪个 Task 消费）、
  checkbox 步骤（TDD 顺序：先贴失败的测试代码，再实现）。
- **report 用 Step 表格**逐步打勾，附两轮测试输出摘要（红→绿）与最终 commit hash。
- **progress.md 记录三类信息**：✅ complete（含 commit 区间、review 结论）、
  ⚠️ minor (deferred)（小瑕疵不阻塞但记账）、**交接说明**（换模型/换会话时
  写清「按计划 Task N 重新派发即可，brief 在哪」）。
- 支持并行派发多个生成型子代理（如按年龄段分 5 批生成事件内容），
  控制器派发前做前置校验（id 无重叠、唯一产出者确认）。

> 这套机制解决的是：**子代理是无状态的**，brief 是它的全部世界；而控制器靠
> ledger 在任何时刻都能换人接手。

---

## 5. 数据管道纪律（life-simulator 最佳实践）

凡是有「数据源 → 生成产物」关系的项目都适用：

- **单一事实源**：所有数据改动只改源头文件（如 chiled.json），
  **生成物严禁手改**（写进 CLAUDE.md 约定章节）。
- **转换器 fail-fast**：未映射的键直接抛错，不带病产出；id 格式、白名单枚举逐一校验。
- **工具幂等**：合并/钳位/精选类脚本重复运行结果不变，可放心重跑。
- **配对校验**：flag 生产者/消费者必须成对，悬空引用在合并阶段就报错。
- **审计留痕**：保留清单（keep-list.json）单独存档供审计。
- **平衡审计自动化**：`sim-balance.ts 500局随机模拟`输出归零率/分布——
  用模拟器代替人肉感受数值设计。

---

## 6. 架构通用模式

- **分层硬边界 + 违规即返工**：画出管线图（如 Decoder→Normalizer→Calculator→
  Repository→UI），写明「X 层禁止直接调用 Y」。边界约束比风格约束重要一个量级。
- **领域模型是唯一跨层契约**：单位固定、缺失字段语义统一（undefined ≠ 0，
  UI 显示 `—` 不伪造）。
- **纯函数核心 + 薄壳 UI**：业务逻辑全部写成纯函数（输入领域对象、输出结构化结果），
  配独立单测；组件只做接线。推导类系统「零存档字段」（从 history 现场推导），
  旧存档天然兼容。
- **接口抽象先行**（kudo）：目标架构的第一期先定义接口 + 本地参考实现
  （KV/流式存储/消息总线），真实 SDK 到位后只换实现，业务代码不动。
- **生成式内容防误伤**：文案重写补丁只许改 title/text，效果值/flags/conditions
  一律保留原值；选项数不匹配即抛错。

---

## 7. 测试策略

- **测试分级隔离**：纯单测（无外部依赖）/ 集成测试（`@Tag("integration")` 显式标注，
  `-Dgroups='!integration'` 可排除）/ E2E（本地跑不进 CI）。日常开发只跑快的。
- **DB 测试模式**：内存实现（fake-indexeddb）+ 真实客户端库注入，不 mock 库本身。
- **TDD 进任务书**：brief 里直接给出失败测试的完整代码，report 里附红→绿两轮输出。
- **验证规范分级**（dumpmgr）：快速迭代只要求编译通过（省时间），
  收尾才全量 lint+test+build；两者都要写明，避免 Agent 自作主张跑全量或偷懒不跑。
- **pre-commit 门禁**：提交前强制跑单测（紧急情况 `--no-verify` 逃生门要写进注释）。
- **开发期专用测试**用 `@Tag("dev")` 标记，出包时排除，不删代码。

---

## 8. Git 提交规范

### 个人项目版（cycling / life-simulator / kudo）

- 前缀 `[NF]`新功能 / `[BF]`缺陷 / `[IM]`改进 / `[CU]`杂务（[DOC] 文档），
  中文 Subject，body 用 `- ` bullet 列细节与测试情况，**无 AI 署名**
- Subject 一句话概括，版本号变更放 body 不放标题；在 CLAUDE.md 同时保存
  正例与反例（防止风格回退）
- 一次提交只含一个 Feature/Bug/改进，禁止混合不相关修改
- 身份统一固定为项目 git config，勿改

### 企业版增量（dumpmgr）

- type 扩展：`SC`(第三方源码注明来源版本) / `RF`(重构) / `Doc` / `OT`(构建工具)；
  NF 必须带禅道任务号，BF 必须带 BugZilla bug 号
- 分支命名表：master / feature/9.x / feature/ bugfix/<bug号> hotfix/ release oem/ private/<user>/
- CU 类个人过程提交，merge request 时压缩为 NF/BF/IM

### 发布流程

每组功能 push 前升一次 minor 版本（构建注入显示）；changelog 数据文件倒序维护，
每版头部追加；CI 流水线 lint→test→build→deploy，**任一样例解析失败即失败（fail-fast）**。

---

## 9. 自动化与 Hooks

| Hook | 作用 | 备注 |
|---|---|---|
| `npm prepare` 设 `core.hooksPath` | npm install 即自动启用 hooks | 免去手动配置 |
| pre-commit 强制单测 | 测试失败阻止提交 | 注释里写 `--no-verify` 逃生门 |
| post-commit `codegraph sync` | 代码索引自动同步 | 存在 `.codegraph/` 才触发 |
| Notification/Stop toast | Windows 弹窗通知需要操作/已完成 | 长任务不用盯屏 |
| 审批规则沉淀 | 手动 allow 过的高频命令固化为 prefix_rule | 审批策略即资产 |

CI 侧：构建产物 gitignored 由 CI 重建；截图/快照类产物用脚本自动生成
（capture-screenshots.mjs 支持 HTTPS_PROXY）。

---

## 10. 安全与隐私红线

1. **真实数据不入库**：用户私有数据目录 gitignored + 写进 CLAUDE.md 红线章节 +
   与可公开数据明确区分（哪些能提交、哪些永远不能）。
2. **密钥不入库**：后端地址/密钥走环境变量（构建时注入）；一旦误提交立即
   重写 git 历史；fork/测试环境不得误写生产资源（API 地址默认置空）。
3. **隐私政策显性化**：PRIVACY.md + LICENSE 补齐并在 README 链接；
   「本地解析不上传」写进产品首屏文案而不只是 README。
4. **安全待办清单化**：security-backlog.md 记录已加固项与高/中/低优先级待办
   （Turnstile 人机验证、限流、依赖审计门禁……），不指望记住。
5. **依赖漏洞响应**：高危依赖当天升级修复并单独 commit。

---

## 11. Code Review 资产化（kudo 最佳实践）

- **review 清单绑定领域不变量**，不是泛泛的风格检查：备份工具就盯
  「数据不能丢、不能错、不能漏」——每个检查点 = 检查项 + 所在文件方法行号 + 风险说明。
- **按严重度分级**：P0 致命（静默数据丢失）/ P1 严重（不完整可检测）/ P2 关注（边界鲁棒），
  另设并发安全、故障恢复、测试覆盖缺口专章。
- 清单开头先画数据流图——理解数据怎么流，才能判断哪里会错。
- 外部评审报告 + 自动截图实测**交叉核实**后再立项，逐项标注
  「已完成勿重做 / 半成品 / 真问题」，避免重复劳动。

---

## 12. 多工具多模型协作

- **CLAUDE.md 与 AGENTS.md 内容保持语义一致**，改规范两处同步；
  所有工具共享同一份 PROGRESS.md 作为唯一事实来源。
- 不同工具各有入口约定（Claude 读 CLAUDE.md，Codex/pi/opencode 读 AGENTS.md），
  但架构、提交、文档规则完全相同。
- 中途换模型/换会话：ledger 写交接说明（计划位置 + brief 位置 + 已完成状态），
  新会话零成本接手。
- 全局设置层面：分档模型映射控成本（轻任务走便宜模型）；MCP 服务
  （codegraph/image-view/node_repl）各工具共享同一套。

---

## 13. 新项目起步清单（Checklist）

从零开一个新项目，按此顺序建立基础设施：

```
□ git init + .gitignore（含私有数据目录、构建产物）
□ CLAUDE.md：概述/命令/架构骨架（哪怕只有三层）
□ AGENTS.md 精简版（若会用多工具）
□ docs/规格说明.md（需求原文，编号章节供引用）
□ docs/PROGRESS.md（含 §0 进行中任务清单 + 维护规则声明）
□ 提交身份 git config 固定；hooks 目录 + prepare 脚本
□ 测试框架选型 + tests/setup + fixture 目录（区分公开样例与私有数据）
□ lint/format 配置
□ CI 流水线（lint→test→build→deploy，fail-fast）
□ 首个功能走一遍：spec → plan → task → DoD 全流程，把流程本身跑通
```

之后每次踩坑：**修 bug → 补测试 → CLAUDE.md 坑清单加一条 → 再提交**。

---

*本文档与各项目 CLAUDE.md 的关系：这里是方法论总纲，项目内文件是具体实例；
两边更新时互相引用即可，不必复制内容。*
