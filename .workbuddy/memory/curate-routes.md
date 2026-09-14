# 全国精选路线补录流水线（curate-* 脚本族）

> 适用范围：给 `src/features/curatedRoutes/` 补路线时的选参、闸门与踩坑。
> 脚本：`scripts/curate-route.mjs`（单条全流程）、`scripts/curate-batch.mjs`（批量驱动）、
> `scripts/generate-curated-routes.mjs`（公共读写函数 + 早期生成脚本）。
> 临时产物：`.tmp/curated-national/`（需求单与校验脚本）、`.tmp/curate/<id>/`（单条几何、待入库条目）。

## 跑批前必读的三条

1. **Overpass 只能单进程串行**。公开镜像（overpass-api.de / kumi / private.coffee）
   常只剩 de 可用且限流 2 槽。并行跑 = 互相抢槽 + 并发写坏数据文件，
   务必 `--delay 6000~9000`。连打十几小时会被打到 IP 级封禁
   （返回 XML 错误页、三个镜像全挂），要隔夜才恢复。
2. **`.tmp/curate/<id>/geometry.json` 是资产**。dry-run 落盘的几何可以在封禁期间
   **离线入库**（`offline-ingest.mjs`），完全不用联网。网络跑挂时先看这里有没有存货——
   2026-09-14 一次性从缓存捞出 100 条可用几何，比傻等网络划算得多。
3. **停后台任务用 TaskStop**，不要只 kill node 进程：bash 循环会马上拉起下一个。

## 闸门口径（必须与测试一致）

`tests/features/curatedRoutes/curatedRoutes.test.ts` 是唯一真源：

| 校验项 | 口径 |
| --- | --- |
| 几何/申报里程比值 | 非 core 条目必须落在 **[0.5, 1.6]** |
| core 条目 | drawn ≥ 500m；语义**只能是「偏短」**（路径只覆盖核心段），用于长环线/往返线 |
| 必填字段 | name/area/desc/tips/source 非空，distance/elevation > 0，difficulty 1~5，sourceGrade ∈ ABC |
| 坐标 | 在中国范围内，且落在本地区 REGION_BBOX 内 |

- **core 上界是坑**：不要把「绕远」的几何标成 core 蒙混过关（core 语义是偏短），
  ratio > 1.6 一律丢弃。曾一次误入 11 条 ratio 1.7~4.6 的废几何，事后逐条剔除。
- **REGION_BBOX 要按「行政区范围 + 余量」写，不能只框主城区**。框窄了会把下辖县市/
  远郊景区误判成锚点错位（重庆只框主城 → 金佛山、长寿湖、山王坪全被拒）。
  `offline-ingest.mjs` 直接从测试文件解析 bbox，别在脚本里再抄一份，防漂移。
- 自写校验脚本的阈值必须和测试一致：曾因自验用 0.3 下限、测试用 0.5，导致自验通过 CI 挂。

## 已知失败模式

- **锚点吸附失败**（最常见）：放宽到 2.5/5km 仍失败，多半是锚点在公园内部、湖心或
  景区步道（OSM 标 footway 会被路网过滤），如 nj-xuanwu 玄武湖。解决是把锚点挪到外围道路。
- **选路绕远**：放宽吸附半径是把双刃剑，必须靠 ratio 闸门兜住。
- **tracks 文件尾逗号**：TS 合法但 JSON 不合法，`readExistingOutput` 会抛错。
  该函数已改成严格模式（解析失败直接抛错中止），防止静默返回空对象后覆盖整份几何。
- **数据量大以后测试超时**：逐点 expect 的全量用例在 200+ 条时会超 vitest 默认 5s，
  这几个用例已放宽到 30s。

## 数据安全

曾经两个 curate 进程并发入库，把 `nationalTracks.ts` 覆盖成只剩 1 条、123 条已上线几何丢失。
现已加「文件锁 + 原子写 + 解析失败即中止」三件套。恢复手法：
`git show HEAD:src/features/curatedRoutes/nationalTracks.ts` 还原，再按 `.tmp/curate`
里的 geometry.json 重灌（repair-tracks.mjs）。**补录前务必先确认 HEAD 已经 push。**
