/**
 * 快照体积门禁测试。
 *
 * 门禁本身也是代码：它悄悄失效（不再拦住超限产物）比没有门禁更糟——
 * 因为团队会以为有人守着。这里用真实子进程跑脚本，断言退出码与关键输出。
 *
 * 三个预算项共用同一个判定函数，因此「通过」与「单文件超限」两个用例
 * 已足以覆盖判定机制；不额外造 200MB+ 的临时文件去触发总量项（不值得的 IO）。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/** 脚本绝对路径（相对本测试文件定位，避免依赖 cwd） */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'check-snapshot-size.mjs')

/** 临时目录集合（用例结束后统一清理） */
const temps: string[] = []

/**
 * 造一个临时快照目录。
 *
 * @param files 相对路径 → 文件字节数
 */
async function makeSnapshot(files: Record<string, number>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'snapshot-size-test-'))
  temps.push(root)
  for (const [rel, size] of Object.entries(files)) {
    const full = join(root, rel)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, Buffer.alloc(size, 0x20))
  }
  return root
}

/**
 * 运行门禁脚本。
 *
 * @param dir 目标目录
 * @returns 退出码与合并输出
 */
function runGate(dir: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, `--dir=${dir}`], (error, stdout, stderr) => {
      const code = error === null ? 0 : ((error as { code?: number }).code ?? 1)
      resolve({ code, output: `${stdout}${stderr}` })
    })
  })
}

afterEach(async () => {
  while (temps.length > 0) {
    await rm(temps.pop() as string, { recursive: true, force: true })
  }
})

describe('check-snapshot-size', () => {
  it('体积正常时通过，并打印分组明细与最大的活动文件', async () => {
    const dir = await makeSnapshot({
      'activities.json': 60_000,
      'manifest.json': 100,
      'records/a.json': 2 * 1024 * 1024,
      'records/b.json': 1 * 1024 * 1024,
      'precomputed/tracks.json': 500_000,
      'tiles/1.png': 40_000,
    })

    const { code, output } = await runGate(dir)

    expect(code).toBe(0)
    expect(output).toMatch(/体积门禁通过/)
    expect(output).toMatch(/records\/ 逐点数据/)
    expect(output).toMatch(/最大的 5 个活动逐点文件/)
    expect(output).toMatch(/records\/a\.json/)
  })

  it('单活动逐点文件超限即失败（详情页首屏事故的前置拦截）', async () => {
    const dir = await makeSnapshot({ 'records/huge.json': 20 * 1024 * 1024 })

    const { code, output } = await runGate(dir)

    expect(code).toBe(1)
    expect(output).toMatch(/体积门禁未通过/)
    expect(output).toMatch(/单活动逐点文件\s*超预算/)
    expect(output).toMatch(/records\/huge\.json/)
  })

  it('目录不存在时静默通过（本地未构建快照不应当阻塞其它检查）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-size-missing-'))
    temps.push(root)

    const { code, output } = await runGate(join(root, 'not-built'))

    expect(code).toBe(0)
    expect(output).toMatch(/体积门禁通过/)
  })
})
