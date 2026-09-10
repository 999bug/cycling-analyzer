# 项目长期记忆（cycling-analyzer）

## ⛔ 记忆写入脱敏规则（2026-09-09 用户强调，最高优先级）

`.workbuddy/memory/` 下的 `.md` **已纳入 Git 并推送至公开仓库**（`.gitignore` 用 `.workbuddy/*` + `!.workbuddy/memory/` 实现，仅 `LOCAL-ONLY.md` 与 `tmp/`、`exports/` 保持忽略）。因此写入前必须脱敏：

- 绝对路径一律占位：本机项目根目录写作 `F:/<repo>`，home 目录写作 `<home>`，不要写真实盘符路径
- 私人数据文件（GPX/FIT/佳明导出包等）只写泛化描述，真实文件名写进未入库的 `LOCAL-ONLY.md`
- 云端文档 nodeId / spaceId、任何 token / key / 邮箱 / 手机号：**一律占位或写 LOCAL-ONLY.md，绝不进入库文件**
- git 历史不可撤销：一旦推送含敏感内容的日记，删除也洗不掉，写之前多想一秒
- 已入库的旧日记已按此规则清理（路径 → `F:/<repo>`、佳明导出包 → `<私人导出包>`、地点 → `<地名>`）

## ⛔⛔ git 仓库安全：绝不使用 rebase（2026-09-10 二次事故，最高优先级）

- **`git rebase`（含 `-i`）在本环境会直接掏空仓库**：2026-09-10 实测，`git rebase -i` 先报
  `could not mark as interactive`，随即 `.git/refs/` 消失、`.git/objects` 被清空（数百 MB → 2 个 tree）、
  reflog 消失、残留 `.git/shallow` 让 fetch 只拉回 1 个提交，整个仓库变成 `not a git repository`。
  这是 2026-09-08 之后的**第二次**同类事故。
- **工作区文件与 index 通常完好**，丢的只是 commit 对象和 ref —— 代码不会没，但提交历史会没。
- 恢复手册（已验证可行）：
  1. `cp -r .git <工作区外路径>` 留现场
  2. `mkdir -p .git/refs/heads .git/refs/tags`（git 靠 refs 目录判定仓库）
  3. `git fetch origin`；若只回 1 个提交 → `.git/shallow` 作祟 → `git fetch --unshallow origin`
  4. fetch 后 ref 可能不落盘（`show-ref` 仍是旧值）→ `git update-ref refs/heads/main <sha>` 手动指过去
  5. `git status` 应看到"原提交的全部内容"变成待提交改动
- **改已提交信息的唯一安全路径**：未 push 时先完整备份 `.git` 到工作区外，再动手；已 push 的 message 视为不可变。
- 环境 shim 怪癖：fetch 不落盘、`git branch a/b`（带斜杠）静默失败不创建、跨目录 `mv` 报 Permission denied。
  涉及 ref 变更一律用 `git update-ref`，不要手改 `.git` 内文件。
- **仓库被掏空后重建提交历史的方法（2026-09-10 实测成功）**：objects 丢失会让 index 里残留
  失效 blob，此时无 pathspec 的 `git commit` 必失败（`invalid object 100644 xxx` / `Error building trees`）。
  解法是 **`git commit -F <msg文件> -- <pathspec...>`**——带 pathspec 时 git 用 HEAD tree + 指定路径的
  工作区内容建提交，绕过失效 index；按主题分组逐个提交即可。`git add -u` 救不了（stat 未变的文件不重写 blob）。
- **⛔ 未经当次明确许可，不执行任何 git 写操作**（2026-09-10 用户第三次强调，原话「别动我 git 了我真是怕了，你已经搞坏我 3 次 git 目录了」）：
  在用户针对**本次任务明确说"提交"**之前，`git add` / `commit` / `push` 一律不做；更不要为了「整理提交历史 / 合并更新日志 / 修字面 `\n`」这类**体感收益很低**的目的去动仓库。只读操作（`status`/`log`/`diff`/`show`/`ls-remote`）不受限。
  背景：`.git` 被掏空的那几次都源于「想把提交历史整理得更好看」（`rebase -i` 改提交信息）。教训是——**用户对仓库安全的在意程度远高于提交信息的整齐度**，宁可留着一堆小提交，也不要动历史。
  写代码时正常改文件即可，改完把「待提交清单」列给用户，由他决定何时提交。

- 事故后 `git fsck` 会持续报 `failed to load pack in position 0/1` + `failed to load pack entry for oid`：
  这是残留 `multi-pack-index` 指向已消失的旧 pack 造成的**误报**。判据是
  `git rev-list --objects --all | awk '{print $1}' | git cat-file --batch-check | grep -c missing` 为 0（可达对象全在）。
  沙箱内无法 mv/rm 掉该索引，可忽略；有写权限时删掉 `.git/objects/pack/multi-pack-index` 即可自动重建。

## 工作流强制规则

- **`codegraph sync` 已由 pre-commit 钩子自动执行**（2026-09-09 验证：commit 后输出 "Syncing CodeGraph ... Done"，无需手动再跑）。提交顺序：先更新 `docs/PROGRESS.md` → 提交 → push。
- **push 直连优先**（2026-09-08/09 两次实测）：仓库 7890 代理常未启动，127.0.0.1:7890/58551 都不通，直连 `git push origin main` 反而秒成功；只有直连失败再试 `git -c https.proxy=http://127.0.0.1:7890 push`（注意 `-c` 必须在 `push` 之前，写成 `git push -c ...` 会被当成 push 参数而报用法错误）。
- **UI 改动先出原型再动手**（用户 2026-09-09 明确要求）：涉及布局/交互调整时，先用 show_widget 画原型给用户审批，批准后才改代码并提交；不要「方案一写完就提交」。
- **「完成后自动 reload」的链路必须防再入**（2026-09-09 无限刷新事故教训）：凡基于持久化状态决定是否刷新的组件，必须区分「本次刚完成」与「早就完成」（后者静默跳过）；实现前先列 状态×终态 表自查，且每个起点状态都要有测试。自动刷新一律走 `@/utils/navigation reloadPage`（jsdom 可注入），禁止直接 `window.location.reload()`。参考：main.tsx 的 sessionStorage 一次性标记模式。

- **不在 effect 里同步 setState**（2026-09-10 实测）：本项目 ESLint 启用了 `react-hooks/set-state-in-effect`，在 effect 体内直接 `setState` 会报 error（"Calling setState synchronously within an effect can trigger cascading renders"）。需要「外部状态变化 → 派生界面状态」时，优先把状态写成纯派生（例：侧边栏是否收起 = `sidebarMode === 'auto' && !revealed`，悬停/焦点事件照常维护 revealed），而不是用 effect 去重置。
- **可折叠侧边栏/面板的裁剪式收起**（2026-09-10 沉淀，参照 `AppLayout.css`）：外层 `width` 过渡 + 内层固定宽度容器 + 外层 `overflow: hidden`，内容不重排；内层用 `flex: 1 0 auto` 撑满而非 `height: 100%`；收起态给内层加 `inert`（React 19 原生支持）让键盘焦点跳过不可见内容；异步读取的偏好加 hydrated 标记 + 首帧 `transition: none`，避免启动「先展开再收起」的闪动。

## 真实数据可用于测试（2026-09-10 用户明确授权）

- 用户明确表示：`private-fixtures/` 里的骑行数据（FIT/GPX）**可以在测试与验证时直接使用**，不必绕开。
  涉及算法/口径类改动（暂停判定、均速、抽稀、回放时间轴）时，优先用它做真实数据回归，而不是只靠合成的
  `tests/fixtures/`——合成数据往往构造不出「抽稀后相邻点间隔 4 分钟」这类真实分布，本次回放 bug 就是靠它定位的。
- 该目录 **gitignored，严禁提交、严禁写进任何入库文件**（文件名/内容都算）。入口脚本：**`npm run check:replay`**
  （`scripts/check-replay-timeline.ts`）——在全量真实轨迹上复算回放时间轴，校验「运动时长 ≤ 回放时长 ≤ 总耗时」
  与「无可见瞬移」两条不变量，硬失败退出码 1。改时间轴/暂停/移动时长口径后跑一次。
  `.workbuddy/tmp/` 下另有两个临时脚本（`replay-batch-diag.ts` 指标对比、`replay-segment-drill.ts` 单段钻取）。
- 跑法：`npm run check:replay [-- <数据目录>] [--verbose]`；
  临时脚本用 `npx tsx --tsconfig tsconfig.scripts.json .workbuddy/tmp/<脚本>.ts private-fixtures`。
- **GPX 口径决定（2026-09-10 用户拍板）**：「长缺口 + 明显位移」**暂不**算作运动中——
  即不改 `isMovingSegment`，GPX 的计时时长/均速维持现有与行者/佳明对齐的口径。
  回放侧的平滑由 `buildMovingTimeline` 的限速补时单独解决，不回头改均速分母。

## 测试强制规则（vitest Windows 小写盘符 bug，2026-09-08 实锤）

- **Git Bash 里跑 vitest 前必须 `cd F:/<repo>`（盘符大写 F）**。若 cwd 是小写 `f:/...`，会触发 vitest #10692：小写盘符加载的 vitest runtime 与 Vite 规范化大写盘符的模块 ID 在 Node ESM 注册表里对不上，测试文件拿到第二份未初始化 runtime，所有测试报 `TypeError: Cannot read properties of undefined (reading 'config')` 或 "Vitest failed to find the current suite"。
- 判别方法：看输出 `RUN v4.x.x X:/path` 的盘符大小写——小写必挂，大写必过。与 NODE_OPTIONS/环境变量无关（曾误诊为宿主 NODE_OPTIONS shim 注入，已纠正）。
- PowerShell 跑 vitest 天然免疫（Set-Location 自动大写盘符），但其 stdout 会被工具吞掉：用 `npx vitest run ... *> out.txt` 落盘再读，或直接 bash `cd F:/...` 跑最省事。
- 单文件：`cd F:/<repo> && npx vitest run tests/xxx.test.ts`；全量约 68s（1041 用例）。

## 文档云端化规则（2026-09-08 用户指定）

- 《批量导出骑行记录教程》的后续改动**直接更新资料库云端版本**，不再只改本地 `private-fixtures/批量导出数据教程/`：云端文档页地址形如 `https://www.workbuddy.cn/space/d/<doc-nodeId>`（nodeId / spaceId 属个人私密标识，**已脱敏，真实值仅存于本地私有配置**：本机 `.workbuddy/memory/LOCAL-ONLY.md`，该文件已在 .gitignore 排除，永不入库）。改前先 `get_doc_reviews.py` 回读基线；大改用 `create_doc.py --node-block-id ... --confirm-overwrite`（全量覆盖须先向用户确认），小改走文本块/审阅编辑。改完用 present_files 打开该 URL 给用户。

## 构建与环境坑

- **`npm run build` 需先 `rm -rf dist`**（2026-09-08）：vite emptyOutDir 触发 WorkBuddy safe-delete shim（移入回收站），dist 1800+ 文件时 genie-trash ETIMEDOUT 导致构建失败；dist 为 gitignored 构建产物，直接 rm 清空后重跑 build 即可。
- **jest-dom `toHaveValue` 对 input[type=number]**：空值返回 null 而非 ''，`toHaveValue('')` 永远失败；断言空值改用 `(el as HTMLInputElement).value === ''`。userEvent.type 遇 `{xx}` 会按按键语法解析，含花括号输入用 fireEvent.change。

## 已知待修复缺陷

- **卫星底图在作者数据区域退化成矢量图**（2026-09-10 发现，**未修复**）：`src/map/localTiles.ts` 的
  `parseAmapTileUrl()` 只抠 `x/y/z`、`hasLocalTile()` 查的 `tiles-manifest.json` key 也只有 `"z/x/y"`，
  **都不含底图模式**；`CachingTileLayer.loadTile()` 的「本地预缓存优先」逻辑于是把卫星(webst style=6)
  请求也返回本地矢量(webrd style=8)瓦片。表现：访客在作者快照覆盖区域切「卫星 / 卫星+路网」时，
  旧视口那片显示路网图、其余显示真卫星（混杂）。修复建议（推荐后者）：非 normal 模式跳过本地预缓存
  直接走在线瓦片（本地本就只预缓存了矢量瓦片），或清单 key 加模式前缀。详见 2026-09-10 日志。
