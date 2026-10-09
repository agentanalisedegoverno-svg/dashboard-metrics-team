// Guardas de publicação sobre dist/: orçamento de bundle e vazamento de dados reais.
import { readFile, readdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const DIST = 'dist'
const BUDGET_JS_GZIP_KB = Number(process.env.BUDGET_JS_GZIP_KB || 190)
const BUDGET_CSS_GZIP_KB = Number(process.env.BUDGET_CSS_GZIP_KB || 20)
const errors = []

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

// 1) Orçamento: JS/CSS carregados na página inicial (entry + modulepreload + css).
const html = await readFile(join(DIST, 'index.html'), 'utf8')
const refs = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
let js = 0
let css = 0
for (const ref of new Set(refs)) {
  const size = gzipSync(await readFile(join(DIST, ref))).length
  if (ref.endsWith('.js')) js += size
  else css += size
}
const kb = (n) => (n / 1024).toFixed(1)
console.log(`Bundle inicial: JS ${kb(js)} kB gzip (limite ${BUDGET_JS_GZIP_KB}) · CSS ${kb(css)} kB gzip (limite ${BUDGET_CSS_GZIP_KB})`)
if (js / 1024 > BUDGET_JS_GZIP_KB) errors.push(`JS inicial acima do orçamento (${kb(js)} kB)`)
if (css / 1024 > BUDGET_CSS_GZIP_KB) errors.push(`CSS inicial acima do orçamento (${kb(css)} kB)`)

// 2) Nenhum dado real: todo JSON de linhas publicado deve ser a base sintética (processo "DEMO-*").
for await (const file of walk(DIST)) {
  if (/(^|[\/])(\.local|\.env)/.test(file) || file.endsWith('.map') === false && /\.(xlsx?|xlsm|csv)$/i.test(file)) {
    errors.push(`Arquivo proibido em dist/: ${file}`)
  }
  if (!file.endsWith('.json')) continue
  const value = JSON.parse(await readFile(file, 'utf8'))
  const rows = Array.isArray(value) ? value : value?.rows
  if (!Array.isArray(rows)) continue
  const real = rows.filter((r) => !String(r?.processo ?? '').startsWith('DEMO-'))
  if (real.length) errors.push(`${file}: ${real.length} linha(s) que não são sintéticas (processo sem prefixo DEMO-)`)
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'))
  process.exit(1)
}
console.log('✓ dist/ dentro do orçamento e sem dados reais')
