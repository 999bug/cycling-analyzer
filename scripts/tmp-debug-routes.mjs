import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(ROOT, '.tmp/curated-v2/tmp-overpass')

function distM(a, b) {
  const cosLat = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  const dLat = (a[0] - b[0]) * 110540
  const dLng = (a[1] - b[1]) * 111320 * cosLat
  return Math.hypot(dLat, dLng)
}

const out = []

/** 列出某点附近所有道路 way 的关键 tags */
function near(id, point, radiusM, label) {
  const json = JSON.parse(readFileSync(resolve(DIR, `${id}-all.json`), 'utf8'))
  out.push(`== ${id} @${label} (${point}) r=${radiusM}m ==`)
  const seen = new Set()
  for (const el of json.elements) {
    if (el.type !== 'way' || !el.geometry) continue
    for (const p of el.geometry) {
      if (distM([p.lat, p.lon], point) <= radiusM) {
        const t = el.tags ?? {}
        const key = `${el.id}`
        if (seen.has(key)) break
        seen.add(key)
        out.push(`  id=${el.id} hw=${t.highway} tunnel=${t.tunnel ?? '-'} name=${t.name ?? '-'} surface=${t.surface ?? '-'} pts=${el.geometry.length}`)
        break
      }
    }
  }
}

// dfh：东方红隧道垭口一带（先大范围找 G109 走廊）
near('dfh', [40.009, 115.965], 900, '垭口西侧')
near('dfh', [40.009, 115.985], 900, '垭口东侧')

// sh：九渡河→四海 中段（安四路走廊）
near('sh', [40.44, 116.385], 700, '中段1')
near('sh', [40.47, 116.395], 700, '中段2')

// byg：白羊沟垭口附近
near('byg', [40.2, 115.945], 700, '白羊沟中段')
near('byg', [40.2068, 115.9379], 500, '垭口')

// sb：官地→交界河 中段（莲花池顶）
near('sb', [40.447, 116.612], 700, '莲花池顶附近')

// cf：担礼→禅房 走廊（上苇店方向）
near('cf', [40.02, 116.042], 600, '南庄村附近')
near('cf', [40.045, 116.025], 600, '上苇店一带')
near('cf', [40.062, 116.005], 600, '禅房以南')

console.log(out.join('\n'))
