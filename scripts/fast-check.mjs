/**
 * 提交前快速验证脚本（npm run check）。
 *
 * 目标：常规提交的本地验证从「全量测试 + 全量 lint」的数分钟压缩到约半分钟，
 * 全量兜底交给 CI（deploy.yml push 后自动 lint + 全量测试 + build，失败则 Pages 保持旧版）。
 *
 * 三项检查并行执行：
 *  1. tsc -b        —— 类型检查（增量，快）
 *  2. eslint        —— 只检查本次改动的 ts/tsx 文件（--full 时全仓库）
 *  3. vitest related —— 按 import 依赖图只跑受影响的测试（--full 或配置文件变更时全量）
 *
 * 用法：
 *   npm run check            # 常规提交前跑这个
 *   npm run check -- --full  # 大改动 / 排查时全量跑
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FULL = process.argv.includes('--full')

/** 配置/全局文件变更影响面不可局部化，测试必须全量。 */
const GLOBAL_IMPACT_RE = /^(vite|vitest)\.config\.|^(tsconfig|eslint\.config|package(-lock)?)\.|tests\/setup\.ts$/

/** 列出工作区改动文件（含已暂存/未暂存/未跟踪），相对仓库根。 */
function listChangedFiles() {
  const out = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  return out
    .split('\n')
    .map((line) => {
      // porcelain 格式：XY <path>；重命名为 R  old -> new
      const body = line.slice(3).trim()
      const arrow = body.indexOf(' -> ')
      return (arrow >= 0 ? body.slice(arrow + 4) : body).replace(/^"|"$/g, '')
    })
    .filter(Boolean)
}

/**
 * 并行跑一个子进程：成功只打一行摘要，失败才输出日志尾部（报错集中在末尾）。
 */
function run(label, args) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      out += d
    })
    child.on('error', (err) => {
      console.error(`\n===== ${label} (FAIL: ${err.message}) =====`)
      resolve(false)
    })
    child.on('close', (code) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`[${code === 0 ? 'PASS' : 'FAIL'}] ${label} (${seconds}s)`)
      if (code !== 0) {
        const lines = out.trimEnd().split('\n')
        process.stdout.write('\n' + lines.slice(-80).join('\n') + '\n')
      }
      resolve(code === 0)
    })
  })
}

// ---- 主流程 ----
const changed = FULL ? [] : listChangedFiles()
const changedTs = changed.filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('node_modules/'))

const tasks = []
tasks.push(run('tsc -b (type check)', [nodeModules('typescript/bin/tsc'), '-b']))

const lintTargets = FULL ? ['.'] : changedTs
if (lintTargets.length > 0) {
  tasks.push(run(`eslint (${FULL ? 'all' : `${lintTargets.length} changed files`})`, [nodeModules('eslint/bin/eslint.js'), ...lintTargets]))
}

// 测试范围：--full / 全局配置变更 → 全量；否则 vitest related 按 import 图精确挑受影响用例
const globalImpact = changed.some((f) => GLOBAL_IMPACT_RE.test(f))
const fullTests = FULL || globalImpact
const testLabel = fullTests ? 'full suite' : `related to ${changedTs.length} changed file(s)`
if (fullTests || changedTs.length > 0) {
  const vitestArgs = fullTests ? ['run'] : ['related', ...changedTs, '--run']
  tasks.push(run(`vitest (${testLabel})`, [nodeModules('vitest/vitest.mjs'), ...vitestArgs]))
}

console.log(`fast-check: ${fullTests ? 'FULL' : 'fast'} mode | tsc + eslint + vitest running in parallel...\n`)

const results = await Promise.all(tasks)
const failed = results.filter((ok) => !ok).length
console.log(`\nfast-check ${failed === 0 ? 'PASSED' : `FAILED (${failed} task(s))`}`)
process.exit(failed === 0 ? 0 : 1)

/** node_modules 内脚本路径（跨平台拼接）。 */
function nodeModules(rel) {
  return path.join(ROOT, 'node_modules', ...rel.split('/'))
}
