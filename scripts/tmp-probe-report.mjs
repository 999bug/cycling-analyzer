import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(ROOT, '.tmp/curated-v2/tmp-overpass')
const out = []
for (const f of readdirSync(DIR).filter((n) => n.endsWith('probe.json')).sort()) {
  try {
    const json = JSON.parse(readFileSync(resolve(DIR, f), 'utf8'))
    const els = json.elements ?? []
    out.push(`== ${f} (${els.length}) ==`)
    const seen = new Set()
    for (const el of els) {
      const name = el.tags?.name ?? '(noname)'
      if (seen.has(name)) continue
      seen.add(name)
      if (el.type === 'way') {
        out.push(`  [way] ${name}  hw=${el.tags?.highway ?? ''}`)
      } else {
        out.push(`  ${name}  ${el.lat ?? '?'},${el.lon ?? '?'}  [${el.tags?.ele ?? ''}]`)
      }
    }
  } catch (e) {
    out.push(`== ${f} PARSE ERROR: ${e.message} ==`)
  }
}
writeFileSync(resolve(ROOT, '.tmp/curated-v2/probe-report.txt'), out.join('\n'), 'utf8')
console.log('done')
