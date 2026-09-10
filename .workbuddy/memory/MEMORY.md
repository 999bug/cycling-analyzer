# 项目长期记忆（cycling-analyzer）

> 本文件是**自动注入**的入口，只放「任何会话都必须先遵守」的红线与主题索引。
> 细节按需读 `memory/` 下的主题文件；历史过程与决策背景读 `memory/YYYY-MM-DD.md`。

## ⛔ 红线一：记忆写入必须脱敏

`memory/**` 已入**公开仓库**（`.gitignore` 用 `.workbuddy/*` + `!.workbuddy/memory/`；仅 `LOCAL-ONLY.md`、
`tmp/`、`exports/` 保持忽略）。写入前必须：

- 项目根写 `F:/<repo>`、home 写 `<home>`，不写真实盘符路径
- 私人数据文件（GPX/FIT/佳明导出包）只写泛化描述，真实文件名进未入库的 `LOCAL-ONLY.md`
- nodeId / spaceId / token / 邮箱 / 手机号一律占位，或只写 `LOCAL-ONLY.md`
- **git 历史不可撤销**——一旦推送含敏感内容，删除也洗不掉，写之前多想一秒

## ⛔ 红线二：git 只做加法，绝不重写历史

- **绝不 `git rebase`（含 `-i`）**：本环境实测会**掏空仓库**（2026-09-08、09-10 两次事故）。
  同时绝不强推、绝不动已 push 的提交。宁可留着一堆小提交，也不要动历史。
- **权限（2026-09-10 用户更新）**：完成一批工作后**自动提交并 push，不必再问**。
- 每次提交后自查 `git log -1 --format='%an <%ae> %cn'` 必须都是 `999bug`。
- 出事了怎么救、身份怎么修、push 怎么走 → 见 `git-ops.md`

## 主题文件索引（按需读）

| 文件 | 什么时候读 |
| --- | --- |
| `git-ops.md` | 要做 git 写操作、仓库异常、提交身份可疑、push 失败时 |
| `testing.md` | 写/跑 vitest 用例，尤其是热力图页、路线图页相关 |
| `build-env.md` | `npm run build` 失败、vitest 起不来、依赖缺失时 |
| `workflow.md` | 改 UI/交互、写 effect、做折叠面板、地图悬浮控件前 |
| `data-docs.md` | 用 `private-fixtures/` 真实数据、改算法口径、改云端教程文档前 |

## 维护规则

- 日记（`YYYY-MM-DD.md`）**只追加**；超过 30 天的日记蒸馏进对应主题文件后删除原文件。
- 新增主题文件必须回到本表的索引里登记，否则后续会话不会知道要读它。
