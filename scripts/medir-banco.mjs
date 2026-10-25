// Mede a latência do banco real (Neon) com as MESMAS leituras que a aplicação faz. Só SELECT, em volume pequeno
// (dezenas de consultas): não altera dados e não pesa no plano gratuito.
//
// Uso: DATABASE_URL=postgresql://... node scripts/medir-banco.mjs [--requisicoes 20] [--simultaneas 1,5,10]
//      (qualquer papel com SELECT em oportunidades serve, ex.: radar_leitor)
import { neon } from '@neondatabase/serverless'

const args = process.argv.slice(2)
const val = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d)
const url = process.env.DATABASE_URL
if (!url) {
  console.error('Falta DATABASE_URL.')
  process.exit(2)
}
const requisicoes = Number(val('--requisicoes', 20))
const niveis = val('--simultaneas', '1,5,10').split(',').map(Number)
const sql = neon(url)

const consultas = {
  'listagem completa (GET /api/oportunidades)': () => sql`select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb) as rows from oportunidades o where o.arquivado_em is null`,
  'leitura legada do painel (GET /api/rows)': () => sql`select ano, mes, status, uf, torre, orcamento::float8, valor_ctc::float8 from oportunidades where arquivado_em is null and not ausente_na_planilha order by id`,
  'opções e usuários (GET /api/opcoes)': () => sql`select lista, valor, ativo, ordem from opcoes order by lista, ordem, valor`,
  'uma oportunidade pelo id': () => sql`select to_jsonb(o) from oportunidades o where o.id = (select min(id) from oportunidades)`,
  'status da carga': () => sql`select ultima_carga_em, erro from carga_status where id = 1`,
}

const pct = (v, p) => v[Math.min(v.length - 1, Math.ceil(v.length * p) - 1)]
const fmt = (v) => `p50 ${pct(v, 0.5).toFixed(0)} ms · p95 ${pct(v, 0.95).toFixed(0)} ms · máx ${v.at(-1).toFixed(0)} ms`

await consultas['status da carga']() // aquece a conexão e acorda o banco (Neon suspende o computador ocioso)
const [{ n }] = await sql`select count(*)::int as n from oportunidades where arquivado_em is null`
console.log(`Banco com ${n} oportunidades vigentes. ${requisicoes} requisições por nível; níveis de simultaneidade: ${niveis.join(', ')}\n`)

for (const [nome, fn] of Object.entries(consultas)) {
  console.log(nome)
  for (const c of niveis) {
    const tempos = []
    let erros = 0
    const t0 = performance.now()
    let proximo = 0
    await Promise.all(
      Array.from({ length: c }, async () => {
        while (proximo < requisicoes) {
          proximo++
          const t = performance.now()
          try {
            await fn()
            tempos.push(performance.now() - t)
          } catch {
            erros++
          }
        }
      }),
    )
    const total = (performance.now() - t0) / 1000
    tempos.sort((a, b) => a - b)
    console.log(`  ${String(c).padStart(2)} simultânea(s): ${fmt(tempos)} · ${(requisicoes / total).toFixed(1)} req/s${erros ? ` · ${erros} ERRO(S)` : ''}`)
  }
}
