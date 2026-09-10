# git 操作手册（cycling-analyzer）

> 红线（绝不 rebase / 自动提交权限）见 `MEMORY.md`。本文件是操作细节与踩坑记录。

## 提交纪律（与 AGENTS.md 同步）

- 只做 `add` / `commit` / `push`。**绝不 rebase、绝不 amend 已 push 的提交、绝不强推。**
- 提交信息：`[NF]`/`[BF]`/`[IM]`/`[CU]` 前缀 + **一句话中文 Subject**（前缀后不加冒号），
  细节全部放正文 bullet —— 改了哪些文件与函数、关键实现点、测试情况、**版本号写正文**；**无 AI 署名**。
- 提交前先更新 `docs/PROGRESS.md`；每次提交版本号都要前进（功能类 `[NF]` 升中位，其余升末位）。
- 只读操作（`status`/`log`/`diff`/`show`/`ls-remote`）不受任何限制。
- **提交前必须确认工作区没有「临时补丁残留」**（2026-09-10 真实事故）：`replay-video-record` 录屏技能
  会临时改 `src/map/TrackReplay.tsx`（换倍速档位 + 注释掉 `followCursor`），脚本被 Ctrl+C 硬杀时不还原，
  曾因此把 `SPEED_OPTIONS = [1, 8, 32, 600]` 和注释掉的 `followCursor` 提进 main（次日才发现）。
  自查两条：① `grep -rn "\[replay-video-record\]" src/ tests/` 为空
  （**别用 `git diff | grep 技能名`**——文档/注释里描述这个坑的文字本身就会命中，会误报）；
  ② `grep -n "SPEED_OPTIONS =" src/map/TrackReplay.tsx` 是 5 档 `[1, 8, 32, 64, 128]`。
  发现残留执行 `node .workbuddy/skills/replay-video-record/scripts/record-replay.mjs --restore-only` 清理。
  机制细节见 `workflow.md` 的「录屏技能的源码补丁」小节。

## 事故恢复手册（仓库被掏空后，2026-09-10 实测可行）

1. `cp -r .git <工作区外路径>` 留现场
2. `mkdir -p .git/refs/heads .git/refs/tags`（git 靠 refs 目录判定仓库）
3. `git fetch origin`；若只回 1 个提交 → `.git/shallow` 作祟 → `git fetch --unshallow origin`
4. fetch 后 ref 可能**不落盘**（`show-ref` 仍是旧值）→ `git update-ref refs/heads/main <sha>` 手动指过去
5. `git status` 应看到「原提交的全部内容」变成待提交改动
6. objects 丢失会让 index 里残留失效 blob，此时**无 pathspec 的 `git commit` 必失败**
   （`invalid object 100644 xxx` / `Error building trees`）。解法：
   **`git commit -F <msg文件> -- <pathspec...>`** —— 带 pathspec 时 git 用 HEAD tree + 指定路径的工作区
   内容建提交，绕过失效 index；按主题分组逐个提交即可。`git add -u` 救不了（stat 未变的文件不重写 blob）。

## 提交身份自查与修正（2026-09-10 踩中）

- `.git/config` 里的 `[user]` 段会在 `.git` 被掏空重建后**丢失**，global 配置
  `lisy <lisy1@info2soft.com>`（备份在 `C:/Users/<home>/.gitconfig`）会顶上来，导致提交作者错误
  （全库 274 次提交里只有那一次是 lisy）。
- 自查：`git log -1 --format='%an <%ae> %cn'` 必须都是 `999bug`。
- 修法：`git config user.name 999bug && git config user.email 999bug@users.noreply.github.com`
  写回本地配置，再
  `GIT_COMMITTER_NAME=999bug GIT_COMMITTER_EMAIL=999bug@users.noreply.github.com git commit --amend --no-edit --author="999bug <999bug@users.noreply.github.com>"`。
  **未 push 才能 amend**；按规矩先 `cp -r .git` 备份到工作区外，改完核对 `HEAD^{tree}` 不变。

## 环境 shim 怪癖

- fetch 不落盘；`git branch a/b`（带斜杠）静默失败不创建；跨目录 `mv` 报 Permission denied。
- 涉及 ref 变更一律用 `git update-ref`，**不要手改 `.git` 内文件**。
- `git fsck` 持续报 `failed to load pack in position 0/1` + `failed to load pack entry for oid`：
  这是残留 `multi-pack-index` 指向已消失的旧 pack 造成的**误报**。判据：
  `git rev-list --objects --all | awk '{print $1}' | git cat-file --batch-check | grep -c missing` 为 0。
  沙箱内删不掉该索引，可忽略；有写权限时删掉 `.git/objects/pack/multi-pack-index` 即自动重建。

## push 策略

- **直连优先**（2026-09-08/09 两次实测）：仓库 7890 代理常未启动，`127.0.0.1:7890`、`58551` 都不通，
  直连 `git push origin main` 反而秒成功。
- 只有直连失败再试 `git -c https.proxy=http://127.0.0.1:7890 push` —— 注意 `-c` 必须在 `push`
  **之前**，写成 `git push -c ...` 会被当成 push 参数而报用法错误。

## 钩子

- `codegraph sync` 由 `.githooks/post-commit` 触发（是 post-commit，不是 pre-commit）。
  顺序：更新 `docs/PROGRESS.md` → 提交 → push。
- ⚠️ **沙箱 PATH 里没有 `codegraph` 命令**，钩子报 `command not found`，即助手发起的提交**实际不会同步图谱**
  ——需要同步时在用户自己的终端里手动跑一次。
