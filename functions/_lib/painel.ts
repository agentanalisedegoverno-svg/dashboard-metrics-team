/**
 * Consultas do painel (/api/rows e /api/status), em um só lugar para a rota e o diagnóstico usarem exatamente o mesmo SQL.
 * Rodam pelo papel `radar_leitor` (só SELECT). Nada aqui vem do usuário: não há parâmetros.
 *
 * POR QUE O JSON É MONTADO NO POSTGRES: o Cloudflare Workers no plano gratuito limita o tempo de CPU por requisição (10 ms), e a CPU
 * é o que o Worker gasta decodificando as linhas do banco (uma a uma, campo a campo) e serializando tudo de novo para JSON. Com
 * ~800 linhas isso passa do teto de vez em quando (erro 1102, que o Cloudflare devolve como 503). Aqui o Postgres devolve o
 * array de linhas JÁ em JSON (uma única coluna de texto) e o Worker só repassa o texto: sem decodificar linha por linha e sem
 * `JSON.stringify`. O resultado é idêntico ao anterior (testado em db/testes/painel.test.ts); só muda quem faz o trabalho.
 */
import type { Sql } from './cadastro.ts'

export type StatusCarga = { ultima_carga_em: string | null; total_linhas: number; erro: string | null }

export async function consultarStatus(sql: Sql): Promise<StatusCarga | undefined> {
  const [status] = (await sql`
      -- total_linhas = oportunidades vigentes AGORA (a coluna da carga ficava velha e contava as "ausentes")
      select greatest(ultima_carga_em, (select max(atualizado_em) from oportunidades)) as ultima_carga_em, erro,
             (select count(*)::int from oportunidades where arquivado_em is null and not ausente_na_planilha and status is distinct from 'Radar-TIC') as total_linhas
      from carga_status where id = 1`) as StatusCarga[]
  return status
}

export type Painel = {
  /** Data da última carga/alteração em ISO UTC (ex.: 2026-10-11T00:08:41.960Z), ou null. */
  atualizado_em: string | null
  total: number
  /** Array JSON das linhas do painel, já como texto (não decodificar: é repassado como veio). */
  linhas: string
}

/** Linhas do painel + data da última atualização, numa única consulta. */
export async function consultarPainel(sql: Sql): Promise<Painel> {
  const [r] = (await sql`
      with base as (
        select id as ord, ano, mes, status, uf, torre, linha_servico as "linhaServico", vistoria, analista,
               motivo_no_go as "motivoNoGo", motivo_lost as "motivoLost", conta_vinculada as "contaVinculada",
               orcamento::float8 as orcamento, valor_ctc::float8 as "valorCtc", valor_vencedor::float8 as "valorVencedor",
               sla::float8 as sla, processo, orgao, descritivo, data_pregao as "dataPregao", acao_ia as "acaoIA"
        from oportunidades where arquivado_em is null and not ausente_na_planilha
          and status is distinct from 'Radar-TIC' -- status Radar-TIC não entra nas métricas nem nos filtros do painel
      )
      select
        (select to_char(greatest(ultima_carga_em, (select max(atualizado_em) from oportunidades)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           from carga_status where id = 1) as atualizado_em,
        (select count(*)::int from base) as total,
        coalesce((select jsonb_agg(to_jsonb(b) - 'ord' order by b.ord) from base b), '[]'::jsonb)::text as linhas`) as Painel[]
  if (!r || typeof r.linhas !== 'string') throw new Error('Resposta inesperada da consulta do painel.')
  return { atualizado_em: r.atualizado_em ?? null, total: Number(r.total ?? 0), linhas: r.linhas }
}

/** Corpo de /api/rows montado por concatenação de texto (sem decodificar nem serializar as linhas). */
export const corpoDoPainel = (p: Painel) => `{"rows":${p.linhas},"updatedAt":${p.atualizado_em ? JSON.stringify(p.atualizado_em) : 'null'},"isMock":false}`
