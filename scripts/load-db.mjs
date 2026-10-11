// Carga da base no Postgres (Neon). Substitui TODAS as linhas de forma atômica.
//
// Uso (o agente chama este script):
//   DATABASE_URL_WRITER=postgresql://radar_escritor:...@host/neondb?sslmode=require \
//     node scripts/load-db.mjs linhas.json [--fonte "agente-claude"]
//
// Entrada aceita:
//   - JSON no contrato do painel: [{ ano, mes, status, ..., dataPregao, acaoIA }, ...]
//   - Matriz bruta da aba "Base Governo" (primeira linha = cabeçalho), usando --raw
//
// O papel `radar_escritor` só consegue executar carregar_oportunidades(jsonb, text):
// não lê, não apaga e não cria nada fora dela.
import { readFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--fonte') + 1])
const raw = args.includes('--raw')
const fonte = args.includes('--fonte') ? args[args.indexOf('--fonte') + 1] : 'agent'
const url = process.env.DATABASE_URL_WRITER

if (!file || !url) {
  console.error('Uso: DATABASE_URL_WRITER=... node scripts/load-db.mjs <arquivo.json> [--raw] [--fonte nome]')
  process.exit(2)
}

let rows = JSON.parse(await readFile(file, 'utf8'))
if (raw) {
  // Reaproveita o mesmo mapeador testado da API (cabeçalho -> campos do painel).
  const { mapRows } = await import('../functions/_lib/rows.ts')
  rows = mapRows(rows)
}
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('Nada a carregar: o arquivo não contém linhas.')
  process.exit(1)
}

const sql = neon(url)
const [{ carregar_oportunidades: total }] = await sql`select carregar_oportunidades(${JSON.stringify(rows)}::jsonb, ${fonte})`
console.log(`✓ ${total} linhas carregadas (fonte: ${fonte})`)
