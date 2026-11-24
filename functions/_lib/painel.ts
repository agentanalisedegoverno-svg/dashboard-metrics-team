/**
 * Consultas do painel (/api/rows e /api/status), em um só lugar para a rota e o diagnóstico usarem exatamente o mesmo SQL.
 * Rodam pelo papel `radar_leitor` (só SELECT). Parâmetros: nenhum; nada aqui vem do usuário.
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

export async function consultarLinhas(sql: Sql) {
  return await sql`
        select ano, mes, status, uf, torre, linha_servico as "linhaServico", vistoria, analista,
               motivo_no_go as "motivoNoGo", motivo_lost as "motivoLost", conta_vinculada as "contaVinculada",
               orcamento::float8 as orcamento, valor_ctc::float8 as "valorCtc", valor_vencedor::float8 as "valorVencedor",
               sla::float8 as sla, processo, orgao, descritivo, data_pregao as "dataPregao", acao_ia as "acaoIA"
        from oportunidades where arquivado_em is null and not ausente_na_planilha
          and status is distinct from 'Radar-TIC' -- status Radar-TIC não entra nas métricas nem nos filtros do painel
        order by id`
}
