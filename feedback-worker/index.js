/**
 * 骑行反馈 Worker：接收站点反馈表单提交，创建 GitHub Issue。
 *
 * 设计要点：
 * - GitHub Token 仅存于服务端环境变量（GH_TOKEN），前端/打包产物永远不含密钥。
 * - CORS 仅放行配置的来源（默认站点域名 + 本地调试域名）。
 * - 按客户端 IP 做简单限流，配合输入校验与蜜罐字段，挡掉大部分脚本刷 issue。
 * - 失败一律向客户端返回泛化错误，绝不泄露 Token 相关信息。
 *
 * 部署：
 *   wrangler secret put GH_TOKEN     # 细粒度 PAT，仅 repo Issues 写权限
 *   wrangler deploy
 */

const DEFAULT_REPO = '999bug/cycling-analyzer'
const GITHUB_API = 'https://api.github.com'

// 反馈类型 -> GitHub label（与前端 src/config.ts 保持一致）
const TYPE_LABELS = {
  'Bug 报告': ['bug'],
  '功能建议': ['enhancement'],
  '其他': ['feedback'],
}
const ALLOWED_TYPES = Object.keys(TYPE_LABELS)

// 字段长度上限（防止超大 payload）
const MAX = { title: 120, description: 2000, contact: 200, version: 50, ua: 300 }

// 简单限流：每窗口最大请求数 / 窗口时长
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60_000

// IP -> 时间戳数组（进程内，低流量足够；Worker 多实例下为尽力而为）
const hits = new Map()

function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

function rateLimited(ip) {
  const now = Date.now()
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (arr.length >= RATE_LIMIT) {
    hits.set(ip, arr)
    return true
  }
  arr.push(now)
  hits.set(ip, arr)
  return false
}

function corsHeaders(origin, allowed) {
  const allow = allowed.includes(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

function buildIssueBody({ type, description, contact, version, ua }) {
  const lines = [description.trim(), '', '---', `类型：${type}`]
  if (version) lines.push(`版本：${version}`)
  if (ua) lines.push(`UA：${ua}`)
  lines.push(`提交时间：${new Date().toISOString()}`)
  if (contact) lines.push(`联系方式：${contact}`)
  return lines.join('\n')
}

function validate(body) {
  if (!body || typeof body !== 'object') return '请求体格式错误'
  const { type, title, description } = body
  if (!ALLOWED_TYPES.includes(type)) return '反馈类型不合法'
  if (typeof title !== 'string' || title.trim().length === 0) return '标题不能为空'
  if (title.length > MAX.title) return '标题过长'
  if (typeof description !== 'string' || description.trim().length === 0) return '描述不能为空'
  if (description.length > MAX.description) return '描述过长'
  for (const field of ['contact', 'version', 'ua']) {
    if (body[field] != null && (typeof body[field] !== 'string' || body[field].length > MAX[field])) {
      return `${field} 字段不合法`
    }
  }
  return null
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || 'https://999bug.github.io,http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const repo = env.REPO || DEFAULT_REPO
    const origin = request.headers.get('Origin') || ''
    const headers = corsHeaders(origin, allowed)

    // 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method not allowed' }, 405, headers)
    }

    if (!allowed.includes(origin)) {
      return json({ ok: false, error: 'origin not allowed' }, 403, headers)
    }

    const ip = clientIp(request)
    if (rateLimited(ip)) {
      return json({ ok: false, error: '请求过于频繁，请稍后再试' }, 429, headers)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: '请求体不是合法 JSON' }, 400, headers)
    }

    // 蜜罐：机器人常会填充隐藏字段，命中则静默"成功"不建 issue
    if (body && typeof body._gotcha === 'string' && body._gotcha.length > 0) {
      return json({ ok: true, issueUrl: '', issueNumber: 0 }, 200, headers)
    }

    const err = validate(body)
    if (err) return json({ ok: false, error: err }, 400, headers)

    const token = env.GH_TOKEN
    if (!token) {
      return json({ ok: false, error: 'server misconfigured' }, 500, headers)
    }

    const title = body.title.trim()
    const labels = TYPE_LABELS[body.type] || []
    const payload = {
      title: `[反馈] ${title}`,
      body: buildIssueBody(body),
      labels,
    }

    let res
    try {
      res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'cycling-analyzer-feedback',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify(payload),
      })
    } catch {
      return json({ ok: false, error: '无法连接 GitHub' }, 502, headers)
    }

    if (!res.ok) {
      // 不向客户端泄露 token 相关细节
      return json({ ok: false, error: '创建 Issue 失败，请稍后重试' }, 502, headers)
    }

    const data = await res.json().catch(() => ({}))
    const issueNumber = data.number
    const issueUrl = data.html_url || `https://github.com/${repo}/issues/${issueNumber}`
    return json({ ok: true, issueUrl, issueNumber }, 200, headers)
  },
}
