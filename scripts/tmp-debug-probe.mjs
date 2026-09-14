import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(ROOT, '.tmp/curated-v2/tmp-overpass')
const json = JSON.parse(readFileSync(resolve(DIR, 'swc-probe.json'), 'utf8'))
const out = []
for (const el of json.elements ?? []) {
  out.push(`${el.tags?.name}  ${el.lat},${el.lon}`)
}
writeFileSync(resolve(ROOT, '.tmp/curated-v2/swc-report.txt'), out.join('\n'), 'utf8')
console.log('done')
