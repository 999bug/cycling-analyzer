# 数据、口径与文档（cycling-analyzer）

## 真实骑行数据可用于测试（2026-09-10 用户明确授权）

- `private-fixtures/` 里的骑行数据（FIT/GPX）**可以在测试与验证时直接使用**，不必绕开。
  涉及算法/口径类改动（暂停判定、均速、抽稀、回放时间轴）时，优先用它做真实数据回归，而不是只靠合成的
  `tests/fixtures/` —— 合成数据往往构造不出「抽稀后相邻点间隔 4 分钟」这类真实分布（回放 bug 就是靠它定位的）。
- **该目录 gitignored：严禁提交、严禁写进任何入库文件（文件名/内容都算）。**
  真实文件名与路径只写未入库的 `LOCAL-ONLY.md`。

## 回放时间轴校验脚本

- `npm run check:replay [-- <数据目录>] [--verbose]`（`scripts/check-replay-timeline.ts`）：
  在全量真实轨迹上复算回放时间轴，校验「运动时长 ≤ 回放时长 ≤ 总耗时」与「无可见瞬移」两条不变量，
  硬失败退出码 1。**改时间轴 / 暂停 / 移动时长口径后跑一次。**
- 临时脚本跑法：`npx tsx --tsconfig tsconfig.scripts.json .workbuddy/tmp/<脚本>.ts private-fixtures`
  （`.workbuddy/tmp/` 下曾放 `replay-batch-diag.ts` 指标对比、`replay-segment-drill.ts` 单段钻取）。

## GPX 口径决定（2026-09-10 用户拍板）

- 「长缺口 + 明显位移」**暂不**算作运动中 —— 即不改 `isMovingSegment`，GPX 的计时时长/均速维持现有
  与行者/佳明对齐的口径。
- 回放侧的平滑由 `buildMovingTimeline` 的限速补时单独解决，**不回头改均速分母**。

## 教程文档云端化（2026-09-08 用户指定）

- 《批量导出骑行记录教程》的后续改动**直接更新资料库云端版本**，不再只改本地
  `private-fixtures/批量导出数据教程/`。云端文档页形如 `https://www.workbuddy.cn/space/d/<doc-nodeId>`，
  nodeId / spaceId 属个人私密标识，**真实值只存未入库的 `LOCAL-ONLY.md`**。
- 流程：改前先 `get_doc_reviews.py` 回读基线；大改用
  `create_doc.py --node-block-id ... --confirm-overwrite`（**全量覆盖须先向用户确认**），
  小改走文本块/审阅编辑；改完用 present_files 打开该 URL 给用户。
