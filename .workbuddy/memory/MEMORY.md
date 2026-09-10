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
- 事故后 `git fsck` 会持续报 `failed to load pack in position 0/1` + `failed to load pack entry for oid`：
  这是残留 `multi-pack-index` 指向已消失的旧 pack 造成的**误报**。判据是
  `git rev-list --objects --all | awk '{print $1}' | git cat-file --batch-check | grep -c missing` 为 0（可达对象全在）。
  沙箱内无法 mv/rm 掉该索引，可忽略；有写权限时删掉 `.git/objects/pack/multi-pack-index` 即可自动重建。

## 工作流强制规则

- **`codegraph sync` 已由 pre-commit 钩子自动执行**（2026-09-09 验证：commit 后输出 "Syncing CodeGraph ... Done"，无需手动再跑）。提交顺序：先更新 `docs/PROGRESS.md` → 提交 → push。
- **push 直连优先**（2026-09-08/09 两次实测）：仓库 7890 代理常未启动，127.0.0.1:7890/58551 都不通，直连 `git push origin main` 反而秒成功；只有直连失败再试 `git -c https.proxy=http://127.0.0.1:7890 push`（注意 `-c` 必须在 `push` 之前，写成 `git push -c ...` 会被当成 push 参数而报用法错误）。
- **UI 改动先出原型再动手**（用户 2026-09-09 明确要求）：涉及布局/交互调整时，先用 show_widget 画原型给用户审批，批准后才改代码并提交；不要「方案一写完就提交」。
- **「完成后自动 reload」的链路必须防再入**（2026-09-09 无限刷新事故教训）：凡基于持久化状态决定是否刷新的组件，必须区分「本次刚完成」与「早就完成」（后者静默跳过）；实现前先列 状态×终态 表自查，且每个起点状态都要有测试。自动刷新一律走 `@/utils/navigation reloadPage`（jsdom 可注入），禁止直接 `window.location.reload()`。参考：main.tsx 的 sessionStorage 一次性标记模式。

## 真实数据可用于测试（2026-09-10 用户明确授权）

- 用户明确表示：`private-fixtures/` 里的骑行数据（FIT/GPX）**可以在测试与验证时直接使用**，不必绕开。
  涉及算法/口径类改动（暂停判定、均速、抽稀、回放时间轴）时，优先用它做真实数据回归，而不是只靠合成的
  `tests/fixtures/`——合成数据往往构造不出「抽稀后相邻点间隔 4 分钟」这类真实分布，本次回放 bug 就是靠它定位的。
- 该目录 **gitignored，严禁提交、严禁写进任何入库文件**（文件名/内容都算）。诊断脚本可放在
  `.workbuddy/tmp/`（同样 gitignored）：现成的有 `replay-batch-diag.ts`（全量轨迹跑新旧判定对比）。
- 跑法：`npx tsx --tsconfig tsconfig.scripts.json .workbuddy/tmp/<脚本>.ts private-fixtures`。

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
