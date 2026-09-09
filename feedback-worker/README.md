# 骑行反馈 Worker（Cloudflare）

站点反馈窗口的后端：接收前端提交的反馈，自动创建 GitHub Issue。
GitHub Token 仅保存在服务端环境变量，**前端与打包产物中不含任何密钥**。

## 架构

```
站点反馈弹窗 ──POST JSON──▶ Cloudflare Worker ──GitHub REST API──▶ 新 Issue
```

- 仓库：`999bug/cycling-analyzer`
- 反馈类型映射为 label：`Bug 报告 → bug`、`功能建议 → enhancement`、`其他 → feedback`
- Issue 标题前缀 `[反馈]`，正文含类型 / 版本 / UA / 提交时间 / 联系方式（选填）

## 部署步骤

### 1. 安装并登录 Wrangler

```bash
npm i -g wrangler        # 或 npx wrangler ...
wrangler login           # 浏览器授权 Cloudflare 账号
```

### 2. 申请 GitHub Token

在 GitHub 生成一个**细粒度 Personal Access Token（fine-grained）**：

- 作用范围：仅选择 `999bug/cycling-analyzer` 这一个仓库
- 权限：`Issues` → **Read and write**（其余全为 No access）
- 过期时间：按需（建议设个期限并到期轮换）

> 经典 PAT 也可，需勾选 `public_repo` 或 `repo` 权限；细粒度更推荐。

### 3. 配置密钥并部署

```bash
cd feedback-worker
wrangler secret put GH_TOKEN      # 粘贴上一步的 Token（只存于 Cloudflare，不入仓库）
wrangler deploy
```

部署成功后终端会输出 Worker URL，形如：

```
https://cycling-feedback.<你的子域名>.workers.dev
```

### 4. 回填前端端点

把上面的 URL 加上 `/submit` 路径，写入前端配置 `src/config.ts` 的 `FEEDBACK_ENDPOINT`：

```ts
export const FEEDBACK_ENDPOINT =
  'https://cycling-feedback.<你的子域名>.workers.dev/submit'
```

也可不改代码，用构建期环境变量注入：

```bash
VITE_FEEDBACK_ENDPOINT='https://.../submit' npm run build
```

### 5. 本地调试

```bash
wrangler dev
```

默认允许 `http://localhost:5173` 来源，可用本地 `npm run dev` 的站点直接联调。

## 防滥用

- **CORS**：仅放行配置的来源（`ALLOWED_ORIGINS`），其他域名无法调用。
- **限流**：按客户端 IP 每 60 秒最多 10 次。
- **输入校验**：类型/标题/描述必填且限长，其余字段限长。
- **蜜罐**：`_gotcha` 字段若被填充则静默返回成功（不建 issue），挡掉批量机器人。
- **错误隔离**：任何上游失败都只向客户端返回泛化错误，不泄露 Token。

> 如需更强的防护，可在前端接入 Cloudflare Turnstile，Worker 侧校验 token（本仓库暂未启用）。

## 配置项

| 变量 | 来源 | 说明 |
|---|---|---|
| `GH_TOKEN` | `wrangler secret put`（密钥） | GitHub Token，仅 Issues 写权限 |
| `ALLOWED_ORIGINS` | `wrangler.toml` `[vars]` | 逗号分隔的允许来源，默认站点 + localhost |
| `REPO` | `wrangler.toml` `[vars]` | 目标仓库，默认 `999bug/cycling-analyzer` |
