# 个人骑行数据分析网站

## 1. 项目背景

开发一个类似 Strava / Garmin Connect 的个人骑行数据分析网站，但本项目定位为：

> **纯前端、个人使用、数据完全本地化、不依赖后端服务器。**

目标是让用户能够将 Garmin / Wahoo / COROS 等设备产生的 `.fit` 骑行文件导入网站，在浏览器中完成 FIT 解析、数据统计、轨迹展示、骑行记录管理和历史趋势分析。

项目最终部署到 GitHub Pages。

访问网站时：

1. 网站从 GitHub Pages 加载静态资源。
2. 用户选择本地骑行数据目录。
3. 浏览器读取目录中的 `.fit` 文件。
4. FIT 文件在浏览器本地解析。
5. 解析后的数据保存到浏览器 IndexedDB。
6. 后续访问网站时可以直接读取历史数据。
7. 原始 FIT 文件原则上不上传任何服务器。

项目定位不是社交平台，而是：

> **一个私有化、免费、开源、个人使用的 Strava Lite。**

---

# 2. 核心设计原则

## 2.1 数据隐私

所有骑行数据默认只存在用户自己的设备上。

禁止：

- 上传 FIT 到第三方服务器
- 默认调用后端 API
- 默认向任何远程服务发送用户骑行数据
- 在 GitHub Pages 中存储用户数据

允许：

- 加载第三方地图瓦片
- 加载公开 CDN 资源
- 使用 OpenStreetMap 等公开地图服务

地图服务需要在 README 中明确说明。

---

# 3. 总体架构

```text
                         ┌──────────────────────┐
                         │      GitHub Pages    │
                         │   Static Web Hosting  │
                         └──────────┬───────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────┐
                    │        React SPA             │
                    │                              │
                    │ Dashboard / Activities      │
                    │ Activity Detail              │
                    │ Statistics / Settings        │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
      File System Access       FIT Parser          IndexedDB
      API / File Input         @garmin/fitsdk       Local Storage
              │                    │                    │
              ▼                    ▼                    ▼
         本地 .fit 文件      标准化 Activity Model    历史骑行数据
```

不实现：

```text
Browser → Backend → Database
```

第一阶段完全不需要服务器。

---

# 4. 技术栈

推荐：

- React
- TypeScript
- Vite
- React Router
- Zustand
- IndexedDB
- Dexie
- `@garmin/fitsdk`
- Leaflet
- Recharts
- ESLint
- Prettier
- Vitest
- GitHub Actions
- GitHub Pages

推荐 Node.js 20+。

项目必须使用 TypeScript，不使用纯 JavaScript。

---

# 5. FIT 文件解析

## 5.1 解析库

优先使用 Garmin 官方 FIT JavaScript SDK：

```text
@garmin/fitsdk
```

官方 SDK 支持浏览器运行环境，并提供：

```typescript
Decoder
Stream
Profile
Utils
```

能够：

- 判断是否为 FIT
- 检查 FIT 文件完整性
- CRC 校验
- 解码 FIT messages
- 转换 FIT 时间
- 处理 scale / offset
- 处理 developer fields
- 获取 Record 数据
- 获取 Session 数据
- 获取 Activity 数据

不要自行实现 FIT 二进制协议解析。

---

# 6. FIT 导入方式

## 6.1 首选：选择目录

首页提供：

```text
选择骑行数据目录
```

调用：

```typescript
window.showDirectoryPicker()
```

遍历目录：

```text
root/
├── 2026-01-01/
│   ├── ride.fit
│   └── ...
├── 2026-01-02/
│   └── ride.fit
└── ...
```

递归寻找：

```text
*.fit
```

支持：

- 单个文件
- 多个文件
- 文件夹递归扫描

---

# 7. 浏览器兼容性

由于 File System Access API 的目录选择能力并非所有浏览器都支持，因此必须实现 fallback。

优先：

```text
showDirectoryPicker()
```

不支持时：

```text
<input type="file" webkitdirectory multiple />
```

同时支持：

```text
拖拽 FIT 文件到页面
```

MVP 浏览器重点支持：

- Chrome
- Edge

Safari / Firefox 不要求在第一阶段实现完整目录授权能力，但网站必须能通过普通文件上传方式导入 FIT。

---

# 8. FIT 导入流程

完整流程：

```text
选择目录
   ↓
扫描目录
   ↓
发现 *.fit
   ↓
计算文件 fingerprint
   ↓
判断是否已经导入
   ↓
未导入
   ↓
FIT 完整性校验
   ↓
FIT Decode
   ↓
提取 Activity / Session / Record
   ↓
标准化数据模型
   ↓
计算统计指标
   ↓
生成轨迹数据
   ↓
保存 IndexedDB
   ↓
刷新 Dashboard
```

---

# 9. 重复文件检测

不能仅依赖文件名。

必须设计：

```typescript
fileFingerprint
```

建议：

```text
SHA-256(file binary)
```

或者：

```text
size + lastModified + filename
```

MVP 推荐 SHA-256。

如果发现：

```text
fingerprint 已经存在
```

则跳过重新解析。

UI 显示：

```text
发现 128 个 FIT 文件
新增 13 个
已存在 115 个
失败 0 个
```

---

# 10. FIT 标准化数据模型

不要让 UI 直接依赖 Garmin SDK 返回的数据结构。

必须建立自己的领域模型。

例如：

```typescript
interface Activity {
  id: string;

  fileId: string;

  fileName: string;

  fingerprint: string;

  activityType: string;

  startTime: string;

  endTime: string;

  duration: number;

  elapsedTime: number;

  distance: number;

  elevationGain: number;

  elevationLoss?: number;

  calories?: number;

  avgSpeed?: number;

  maxSpeed?: number;

  avgHeartRate?: number;

  maxHeartRate?: number;

  avgCadence?: number;

  maxCadence?: number;

  avgPower?: number;

  maxPower?: number;

  normalizedPower?: number;

  trainingLoad?: number;

  ftp?: number;

  device?: DeviceInfo;

  route?: RouteData;

  records?: ActivityRecord[];
}
```

---

# 11. Record 数据

这是项目最关键的数据之一。

需要保留 FIT 中的：

```text
timestamp
latitude
longitude
altitude
distance
speed
heartRate
cadence
power
temperature
grade（如果可计算）
```

统一单位：

```text
距离：米
速度：m/s
海拔：米
心率：bpm
踏频：rpm
功率：W
时间：Unix timestamp / ISO 8601
经纬度：十进制度
```

---

# 12. RouteData

```typescript
interface RoutePoint {
  timestamp: number;

  latitude: number;

  longitude: number;

  altitude?: number;

  distance?: number;

  speed?: number;

  heartRate?: number;

  cadence?: number;

  power?: number;
}
```

第一阶段允许保存完整 Record。

但地图绘制时需要提供：

```text
route simplification
```

避免一次绘制几十万个点导致页面卡顿。

可以采用：

```text
Douglas-Peucker
```

或者基于距离阈值的数据抽稀。

---

# 13. Dashboard

首页不是简单文件列表，而应该做成个人骑行 Dashboard。

显示：

```text
本周
骑行次数
骑行距离
骑行时间
爬升

本月
骑行次数
骑行距离
骑行时间
爬升

总计
骑行次数
总距离
总时间
总爬升
```

同时提供趋势：

```text
过去 30 天距离
过去 90 天距离
过去一年距离
```

---

# 14. Activity List

骑行记录页面。

支持：

```text
日期
距离
时间
爬升
平均速度
平均心率
平均功率
```

列表支持：

- 日期排序
- 距离排序
- 时间排序
- 搜索
- 分页
- 按月份筛选
- 按运动类型筛选

例如：

```text
2026-08-16
北京城区夜骑

82.31 km
03:21:35
+642 m
24.5 km/h
148 bpm
218 W
```

---

# 15. Activity Detail

这是整个项目最重要的页面。

页面布局参考 Strava，但不要照搬 UI。

推荐：

```text
┌──────────────────────────────────────┐
│ 北京城区夜骑                         │
│ 2026-08-16 19:12                    │
├──────────────────────────────────────┤
│                                      │
│              地图轨迹                 │
│                                      │
├────────┬────────┬────────┬──────────┤
│ 距离   │ 时间   │ 爬升   │ 平均速度  │
├────────┼────────┼────────┼──────────┤
│ 心率   │ 功率   │ 踏频   │ 卡路里    │
├──────────────────────────────────────┤
│                                      │
│ 速度 / 时间图                         │
│                                      │
├──────────────────────────────────────┤
│ 心率 / 时间图                         │
│                                      │
├──────────────────────────────────────┤
│ 功率 / 时间图                         │
│                                      │
├──────────────────────────────────────┤
│ 海拔 / 距离图                         │
│                                      │
└──────────────────────────────────────┘
```

---

# 16. 地图

使用 Leaflet。

地图显示：

```text
骑行轨迹
起点
终点
```

轨迹颜色可以根据：

```text
速度
心率
功率
海拔
```

切换。

例如：

```text
轨迹模式：

[默认]

[速度]

[心率]

[功率]

[海拔]
```

MVP 首先实现默认轨迹。

---

# 17. 图表

使用 Recharts。

必须支持：

### 速度

```text
X：时间 / 距离
Y：速度
```

### 心率

```text
X：时间 / 距离
Y：心率
```

### 功率

```text
X：时间 / 距离
Y：功率
```

### 海拔

```text
X：距离
Y：海拔
```

图表必须支持：

```text
Tooltip
鼠标联动
缩放
```

后续可以增加：

```text
速度 + 心率
功率 + 心率
踏频 + 功率
```

---

# 18. 本地数据库

使用 IndexedDB。

推荐：

```text
Dexie
```

数据库：

```text
cycling-data
```

表：

```text
activities
activity_records
files
settings
```

例如：

```text
activities
----------------------
id
fileId
startTime
distance
duration
elevationGain
avgSpeed
avgHeartRate
avgPower
...
```

```text
activity_records
----------------------
id
activityId
timestamp
latitude
longitude
altitude
speed
heartRate
cadence
power
...
```

注意：

> 不建议把整个 FIT decode 后的巨大 JSON 全量无脑塞进一个对象。

需要拆分 Activity metadata 与 Record 数据。

---

# 19. 原始 FIT 文件是否保存

设计成可配置。

默认：

```text
不保存原始 FIT 文件
```

只保存：

```text
解析后的标准化数据
```

设置中可以增加：

```text
[ ] 保存原始 FIT 文件
```

如果浏览器存储空间允许，可以保存 Blob。

---

# 20. 本地目录与 IndexedDB 的关系

用户第一次选择目录：

```text
选择 D:/Cycling
```

系统扫描：

```text
D:/Cycling/**/*.fit
```

解析结果存入：

```text
IndexedDB
```

以后打开网站：

```text
IndexedDB → 展示历史骑行
```

不需要每次重新解析所有 FIT。

---

# 21. 文件同步

提供按钮：

```text
同步骑行数据
```

执行：

```text
扫描目录
 ↓
发现新 FIT
 ↓
检查 fingerprint
 ↓
解析新文件
 ↓
写入 IndexedDB
```

这样用户只需要把新的 FIT 文件放入本地目录，再点击：

```text
同步
```

即可。

---

# 22. 数据导入进度

如果一次导入 1000 个 FIT 文件，不能阻塞页面。

显示：

```text
正在导入骑行数据

███████████████░░░░░ 76%

已处理：
762 / 1000

成功：
758

失败：
4
```

失败文件必须记录：

```text
文件名
错误原因
```

允许：

```text
重新解析失败文件
```

---

# 23. Web Worker

FIT 文件解析应该考虑放入：

```text
Web Worker
```

主线程负责：

```text
UI
```

Worker 负责：

```text
FIT Decode
数据转换
统计计算
轨迹处理
```

避免大型 FIT 文件解析造成页面卡顿。

---

# 24. 错误处理

必须区分：

### 非 FIT 文件

```text
不是有效的 FIT 文件
```

### FIT 损坏

```text
FIT 文件 CRC 校验失败
```

### FIT 可以解析但缺少 Record

```text
FIT 文件有效，但没有可用的骑行轨迹数据
```

### 数据字段缺失

例如：

```text
没有心率
没有功率
没有踏频
```

不能导致整个 Activity 解析失败。

UI 只显示：

```text
暂无数据
```

---

# 25. 数据字段兼容性

不同设备的数据字段并不完全一致。

因此：

> 不允许假设所有 FIT 文件一定存在 power / heart rate / cadence 等字段。

例如：

```text
功率不存在
```

则：

```text
avgPower = null
maxPower = null
Power Chart 不显示
```

而不是：

```text
0 W
```

因为：

```text
null ≠ 0
```

---

# 26. 自动计算指标

第一阶段：

```text
距离
时间
平均速度
最高速度
爬升
平均心率
最高心率
平均踏频
最高踏频
平均功率
最高功率
```

后续增加：

```text
Normalized Power
Intensity Factor
Training Stress Score
功率曲线
心率区间
功率区间
训练负荷
骑行效率
```

注意：

这些高级指标必须建立在明确的用户配置上，例如：

```text
FTP
最大心率
心率区间
体重
```

不能在没有依据的情况下伪造计算。

---

# 27. 用户设置

设置页面：

```text
个人信息

昵称
体重
身高
FTP
最大心率
静息心率

单位

公里 / 英里
公制 / 英制

时间格式

24h / 12h
```

默认全部使用公制：

```text
km
m
kg
bpm
W
```

---

# 28. 个人统计

增加：

```text
Statistics
```

支持：

```text
总骑行次数
总距离
总时间
总爬升
平均单次距离
平均速度
最长骑行
单次最大爬升
最快速度
最高功率
```

时间范围：

```text
本周
本月
今年
过去 12 个月
全部
自定义
```

---

# 29. 日历

提供：

```text
Calendar
```

类似 GitHub Contribution Graph。

每天根据骑行距离显示强度。

例如：

```text
2026-08

周一 周二 周三 周四 周五 周六 周日

     ■    ■         ■
■    ■              ■
          ■    ■
```

鼠标移入：

```text
2026-08-16

2 次骑行
127.4 km
4h32m
+1245m
```

---

# 30. 数据搜索

支持：

```text
搜索骑行名称
搜索日期
搜索设备
```

过滤：

```text
距离 > 100km
爬升 > 1000m
功率 > 200W
```

MVP 可以先实现日期和文本搜索。

---

# 31. Activity 名称

FIT 文件可能没有漂亮的 Activity 名称。

默认：

```text
2026-08-16 骑行
```

允许用户修改：

```text
北京城区夜骑
```

修改后的名称保存到 IndexedDB。

---

# 32. 数据删除

Activity Detail 页面提供：

```text
删除活动
```

删除前确认：

```text
确定删除这次骑行？

删除后将从本地数据库中移除。
```

必须支持：

```text
删除单个活动
```

Settings 中提供：

```text
清空全部本地数据
```

必须二次确认。

---

# 33. 数据导出

为了防止浏览器 IndexedDB 数据丢失，必须考虑数据备份。

提供：

```text
导出数据
```

格式：

```text
.json
```

以及：

```text
导入数据
```

这样用户可以把数据迁移到：

```text
另一台电脑
```

MVP 必须支持 JSON 数据备份。

---

# 34. GitHub Pages

项目最终必须能够：

```text
npm run build
```

生成：

```text
dist/
```

然后部署到：

```text
GitHub Pages
```

使用：

```text
GitHub Actions
```

自动部署。

流程：

```text
git push
   ↓
GitHub Actions
   ↓
npm install
   ↓
npm run lint
   ↓
npm run test
   ↓
npm run build
   ↓
Deploy GitHub Pages
```

---

# 35. SPA 路由

页面：

```text
/
 /activities
 /activities/:id
 /statistics
 /calendar
 /settings
```

必须考虑 GitHub Pages 的 SPA 路由问题。

不要假设服务器支持：

```text
history fallback
```

需要采用适合 GitHub Pages 的部署策略。

---

# 36. UI 风格

整体视觉参考：

```text
Strava
Garmin Connect
Intervals.icu
TrainingPeaks
```

但不要直接复制任何产品 UI。

设计要求：

```text
现代
简洁
偏运动科技
深色/浅色
响应式
Desktop 优先
```

首页应该有明显的数据 Dashboard 感。

---

# 37. MVP 必须实现

第一阶段不要一次性做所有高级功能。

MVP 只要求：

### P0

```text
项目初始化
Git 初始化
React + TypeScript + Vite
GitHub Actions
GitHub Pages 部署

FIT 文件导入
FIT 文件解析
目录扫描
重复检测
IndexedDB

Activity List
Activity Detail

地图轨迹
距离
时间
爬升
平均速度

心率图
速度图
海拔图

数据删除
数据导入/导出
```

做到这些，就已经形成一个可用产品。

---

# 38. P1 功能

MVP 完成后再做：

```text
功率分析
踏频分析
统计 Dashboard
日历
高级筛选
训练负荷
FTP
心率区间
功率区间
轨迹颜色分析
```

---

# 39. P2 功能

未来：

```text
Segment
路线分析
个人纪录
功率曲线
FTP 自动估算
VO2Max 估算
Training Load
Fitness / Fatigue
骑行区域统计
热力图
设备统计
自行车统计
```

---

# 40. 不做的事情

第一阶段明确禁止 Agent 擅自实现：

```text
用户登录
社交关系
关注
点赞
评论
好友
排行榜
云端数据库
后端 API
支付
订阅
实时 GPS
实时骑行
```

项目的核心价值是：

> 本地数据分析。

---

# 41. 项目目录

建议结构：

```text
cycling-analyzer/
├── .github/
│   └── workflows/
│       └── deploy.yml
│
├── public/
│
├── src/
│   ├── app/
│   ├── components/
│   ├── pages/
│   ├── layouts/
│   │
│   ├── features/
│   │   ├── activity/
│   │   ├── dashboard/
│   │   ├── statistics/
│   │   ├── calendar/
│   │   ├── import/
│   │   └── settings/
│   │
│   ├── fit/
│   │   ├── decoder/
│   │   ├── normalizer/
│   │   ├── calculator/
│   │   └── worker/
│   │
│   ├── storage/
│   │   ├── db.ts
│   │   ├── repositories/
│   │   └── migrations/
│   │
│   ├── map/
│   ├── charts/
│   ├── stores/
│   ├── hooks/
│   ├── types/
│   ├── utils/
│   └── constants/
│
├── tests/
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
├── README.md
└── LICENSE
```

---

# 42. FIT 模块职责

必须保持清晰的模块边界。

```text
FIT Decoder
    ↓
FIT Normalizer
    ↓
Activity Calculator
    ↓
Storage Repository
    ↓
UI
```

禁止：

```text
React Component
    ↓
直接调用 Garmin Decoder
```

React 页面不能直接操作 FIT 二进制解析。

---

# 43. 测试

至少准备：

```text
有效 FIT
损坏 FIT
空 FIT
没有 Record 的 FIT
只有心率没有功率
有功率没有心率
GPS 数据缺失
多个 Session
重复 FIT
超大 FIT
```

测试：

```text
FIT Decoder
Normalizer
Calculator
Fingerprint
Repository
```

至少提供一批真实 FIT 样例用于测试。

注意不要把用户个人真实骑行文件直接提交到公开 GitHub 仓库。

---

# 44. 性能要求

目标：

```text
单个普通 FIT 文件：
< 3 秒完成解析

100 个 FIT 文件：
不能出现明显 UI 卡死

1000 个 Activity：
Activity List 仍然可以正常使用
```

如果解析过程中出现明显卡顿：

```text
迁移到 Web Worker
```

地图必须进行轨迹抽稀。

图表不允许一次渲染几十万个原始 Record。

---

# 45. 数据一致性

FIT 原始数据：

```text
尽量保留
```

业务计算数据：

```text
独立保存
```

不要因为重新计算统计数据而修改原始 Record。

未来如果算法升级，可以：

```text
重新计算 Activity Summary
```

而不需要重新解析 FIT。

---

# 46. README

README 至少包含：

```text
项目介绍

主要功能

技术栈

本地运行

npm install
npm run dev

构建

npm run build

测试

npm run test

部署

GitHub Pages

数据隐私说明

FIT 解析说明

浏览器兼容性

项目截图
```

明确告诉用户：

> 所有骑行数据默认只保存在浏览器本地，不上传服务器。

---

# 47. Agent 执行方式

Agent 不应该一开始就实现所有功能。

严格按照以下阶段开发。

## Phase 1：项目初始化

完成：

```text
创建项目目录
初始化 Git
初始化 Vite
React
TypeScript
ESLint
Prettier
Vitest
基础路由
基础 Layout
```

要求：

```bash
git init
```

并创建第一次 commit：

```text
chore: initialize cycling analyzer
```

---

## Phase 2：FIT Parser

完成：

```text
@garmin/fitsdk
Decoder
FIT integrity check
Activity
Session
Record
Normalizer
```

先写测试。

必须能够：

```text
FIT → Activity
```

---

## Phase 3：IndexedDB

实现：

```text
Dexie
activities
activity_records
files
settings
```

完成：

```text
新增
查询
修改
删除
```

---

## Phase 4：Import

完成：

```text
选择目录
扫描 FIT
Fingerprint
重复检测
导入进度
错误处理
```

---

## Phase 5：Activity List

完成：

```text
Activity List
搜索
排序
筛选
分页
```

---

## Phase 6：Activity Detail

完成：

```text
Summary
Map
Route
Charts
Speed
HR
Elevation
Power
Cadence
```

---

## Phase 7：Dashboard

完成：

```text
周
月
年
总计
```

---

## Phase 8：GitHub Pages

完成：

```text
GitHub Actions
Build
Deploy
SPA
```

最后验证：

```text
从 GitHub Pages 打开网站
选择本地目录
导入真实 FIT
查看骑行数据
刷新页面
数据依旧存在
```

---

# 48. Definition of Done

一个版本只有满足以下条件才算完成：

```text
[ ] 可以从 GitHub Pages 打开
[ ] 可以选择本地 FIT 文件夹
[ ] 可以扫描 FIT 文件
[ ] 可以识别 FIT 文件
[ ] 可以解析 FIT
[ ] 可以读取 Activity
[ ] 可以读取 Session
[ ] 可以读取 Record
[ ] 可以显示骑行距离
[ ] 可以显示骑行时间
[ ] 可以显示爬升
[ ] 可以显示平均速度
[ ] 可以显示地图轨迹
[ ] 可以显示速度曲线
[ ] 可以显示心率曲线
[ ] 可以显示海拔曲线
[ ] 可以保存到 IndexedDB
[ ] 刷新页面数据仍然存在
[ ] 重复 FIT 不会重复导入
[ ] 损坏 FIT 不会导致页面崩溃
[ ] 没有心率/功率数据时 UI 正常
[ ] 可以删除骑行记录
[ ] 可以导出本地数据库
[ ] 可以导入备份数据
[ ] GitHub Actions 可以自动部署
```

---

# 49. 最重要的开发约束

Agent 开发过程中必须遵守：

1. 不要自行实现 FIT 二进制解析器，优先使用 Garmin 官方 FIT JavaScript SDK。
2. 不要引入后端。
3. 不要引入数据库服务器。
4. 不要上传用户 FIT。
5. 不要把 FIT Decoder 与 React UI 强耦合。
6. 不要一次性把所有 Record 直接渲染到 DOM。
7. 不要假设 FIT 文件一定存在心率、功率、踏频。
8. 不要把缺失字段当成 0。
9. 不要为了“未来功能”过度设计。
10. 每完成一个 Phase，都必须保证项目可以运行。
11. 每完成一个 Phase，执行测试和 TypeScript 检查。
12. 每个阶段完成后提交 Git commit。
13. 优先保证 FIT 解析和数据准确性，再优化 UI。
14. 所有涉及数据计算的逻辑必须有单元测试。

---

# 50. 第一阶段最终目标

第一阶段不要追求成为 Strava。

只需要实现：

> **我把 Garmin/Wahoo 导出的 FIT 文件放进一个本地文件夹 → 打开 GitHub Pages → 选择这个文件夹 → 网站自动读取 FIT → 自动解析 → 展示骑行轨迹、距离、时间、爬升、速度、心率、海拔 → 数据保存在浏览器本地。**

只要这个闭环跑通，项目就成功了一半。

后续再围绕：

```text
Power
FTP
Training Load
PR
Segment
Statistics
Calendar
Heatmap
```

逐步扩展。