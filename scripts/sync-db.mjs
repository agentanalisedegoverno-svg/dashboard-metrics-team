// Sincroniza a aba "Base Governo" com o banco por MERGE (convivência planilha + web).
//
// Uso:
//   node scripts/sync-db.mjs matriz.json --dry-run               (valida, imprime o relatório de qualidade)
//   DATABASE_URL_WRITER=postgresql://radar_escritor:...@host/neondb?sslmode=require \
//     node scripts/sync-db.mjs matriz.json [--fonte nome] [--substituir-legado]
//
// matriz.json = usedRange.values da aba (primeira linha = cabeçalho, 34 colunas).
// Linhas editadas na web nunca são sobrescritas; linhas que sumiram da planilha ficam
// marcadas como ausentes (não são apagadas). --substituir-legado só na primeira carga:
// troca as linhas antigas (sem chave) pelas já chaveadas.
import { readFile, writeFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'
import { mapPlanilha } from '../functions/_lib/planilha.ts'

const args = process.argv.slice(2)
const val = (flag, def) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : def)
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--fonte' && args[i - 1] !== '--relatorio')
const dryRun = args.includes('--dry-run')
const url = process.env.DATABASE_URL_WRITER

if (!file || (!url && !dryRun)) {
  console.error('Uso: DATABASE_URL_WRITER=... node scripts/sync-db.mjs <matriz.json> [--dry-run] [--fonte nome] [--substituir-legado] [--relatorio saida.json]')
  process.exit(2)
}

const { rows, avisos, resumo } = mapPlanilha(JSON.parse(await readFile(file, 'utf8')))
if (rows.length === 0) {
  console.error('Nada a sincronizar: a matriz não contém linhas.')
  process.exit(1)
}
const rel = val('--relatorio')
if (rel) await writeFile(rel, JSON.stringify({ resumo, avisos }, null, 2))
console.log(`Linhas: ${rows.length} | avisos de qualidade: ${avisos.length}`)
console.log(resumo)

if (dryRun) {
  console.log('✓ dry-run: nada foi gravado')
  process.exit(0)
}

const sql = neon(url)
const [{ sincronizar_planilha: r }] = await sql`
  select sincronizar_planilha(${JSON.stringify(rows)}::jsonb, ${val('--fonte', 'agent')}, ${args.includes('--substituir-legado')})`
console.log('✓ sincronizado:', r)
