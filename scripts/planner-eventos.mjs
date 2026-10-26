// Radar -> Planner: exporta oportunidades criadas/alteradas pela WEB como eventos JSON (v2)
// para a pasta `eventos/entrada` do planner-auto, que cria/atualiza os cartões.
//
// Uso:
//   DATABASE_URL_PLANNER=postgresql://radar_planner:...@host/neondb?sslmode=require \
//     node scripts/planner-eventos.mjs --saida "C:\...\planner-auto\eventos\entrada" [--dry-run] [--ativar]
//
//   --ativar   grava o marco (agora). Só oportunidades criadas DEPOIS dele são enviadas;
//              as que já existiam (planilha) nunca vão para o Planner.
//   --dry-run  mostra o que seria gerado, sem gravar arquivos nem marcar como exportado.
//
// Idempotente: cada oportunidade só gera novo evento quando sua `versao` aumenta.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'
import { montarEvento, nomeArquivo } from '../functions/_lib/planner.ts'

const args = process.argv.slice(2)
const val = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d)
const dryRun = args.includes('--dry-run')
const saida = val('--saida', process.env.PLANNER_EVENTOS_DIR)
const url = process.env.DATABASE_URL_PLANNER

if (!url || (!saida && !dryRun && !args.includes('--ativar'))) {
  console.error('Uso: DATABASE_URL_PLANNER=... node scripts/planner-eventos.mjs --saida <pasta eventos\entrada> [--dry-run] [--ativar]')
  process.exit(2)
}

const mapa = JSON.parse(await readFile(new URL('../config/planner-mapa.json', import.meta.url), 'utf8'))
const sql = neon(url)

if (args.includes('--ativar')) {
  const [m] = await sql`update planner_marco set marco = coalesce(marco, now()) where id = 1 returning marco`
  console.log(`✓ integração ativa; marco = ${new Date(m.marco).toISOString()} (só oportunidades criadas depois dele são enviadas)`)
  if (!saida) process.exit(0)
}

const [{ marco }] = await sql`select marco from planner_marco where id = 1`
if (!marco) {
  console.error('Integração desligada (sem marco). Rode uma vez com --ativar.')
  process.exit(1)
}

const emails = new Map(
  (await sql`select nome, email from usuarios where email is not null and ativo`).map((u) => [u.nome, u.email]),
)

const pendentes = await sql`
  select o.id, o.codigo, o.versao, o.status, o.torre, o.orgao, o.descritivo, o.objeto, o.processo, o.uasg, o.data_pregao_dt::text as data_pregao_dt, o.hora_pregao::text as hora_pregao,
         o.analista, o.linha_servico, o.observacoes, o.orcamento::float8 as orcamento, o.orcamento_sigiloso,
         e.versao_exportada
  from oportunidades o
  left join planner_exportacao e on e.oportunidade_id = o.id
  where o.fonte = 'web' and o.arquivado_em is null and o.criado_em >= ${marco}
    and (e.oportunidade_id is null or o.versao > e.versao_exportada)
  order by o.id`

let gerados = 0
const semPlano = []
if (!dryRun && saida) await mkdir(saida, { recursive: true })
for (const o of pendentes) {
  const tipo = o.versao_exportada == null ? 'oportunidade_nova' : 'oportunidade_atualizada'
  const ev = montarEvento(o, tipo, mapa, (nome) => emails.get(nome) ?? null)
  if (!ev) { semPlano.push(`#${o.id} (torre: ${o.torre ?? 'vazia'})`); continue }
  if (dryRun) {
    console.log(`[dry-run] ${tipo} ${ev.chave} -> ${ev.planoNome} / ${ev.cartao.bucket} | resp: ${ev.cartao.responsavel ?? '—'}`)
  } else {
    await writeFile(`${saida}/${nomeArquivo(ev)}`, JSON.stringify(ev, null, 2), 'utf8')
    await sql`
      insert into planner_exportacao (oportunidade_id, versao_exportada, chave)
      values (${o.id}, ${o.versao}, ${ev.chave})
      on conflict (oportunidade_id) do update set versao_exportada = excluded.versao_exportada, exportado_em = now()`
  }
  gerados++
}
console.log(`${dryRun ? '[dry-run] ' : ''}${gerados} evento(s)${semPlano.length ? ` | sem plano (torre não mapeada): ${semPlano.join(', ')}` : ''}`)
