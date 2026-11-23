/**
 * API de leitura: consulta das oportunidades (todos os campos) por aplicações externas e agentes. Somente visualização.
 *
 * Segurança em camadas: (1) a chave precisa ter escopo `leitura` (a de `escrita` não lê e a de leitura não cria); (2) a consulta usa a
 * conexão do papel `radar_leitor` (só SELECT), então nem um bug aqui consegue gravar; (3) todos os filtros são parâmetros vinculados,
 * nunca texto concatenado; (4) parâmetro desconhecido ou inválido é recusado com 422, em vez de devolver tudo por engano.
 */
import { z } from 'zod'
import type { Sql } from './cadastro.ts'
import { send } from './http.ts'

export const LIMITE_PADRAO = 100
export const LIMITE_MAXIMO = 500

const texto = (max: number) => z.string().trim().min(1).max(max)
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Data inválida')
const numero = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'Use um número em reais com ponto decimal, ex.: 1500000.50').transform(Number)
const inteiro = (min: number, max: number) => z.string().regex(/^\d{1,9}$/, 'Use um número inteiro').transform(Number).refine((n) => n >= min && n <= max, `Use de ${min} a ${max}`)

const consulta = z.object({
  q: texto(100).optional(),
  status: texto(60).optional(),
  torre: texto(60).optional(),
  uf: texto(2).optional(),
  linha_servico: texto(100).optional(),
  analista: texto(100).optional(),
  segmento: texto(20).optional(),
  orgao: texto(100).optional(),
  pregao_de: data.optional(),
  pregao_ate: data.optional(),
  valor_min: numero.optional(),
  valor_max: numero.optional(),
  atualizado_desde: z.string().refine((s) => /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) && !Number.isNaN(Date.parse(s)), 'Use data ou data e hora ISO, ex.: 2026-11-01T00:00:00Z').optional(),
  arquivadas: z.enum(['true', 'false', '1', '0']).optional(),
  limite: inteiro(1, LIMITE_MAXIMO).optional(),
  offset: inteiro(0, 1_000_000).optional(),
}).strict()

/** Escapa `%`, `_` e `\` para o texto digitado valer como texto puro dentro do ILIKE. */
const escaparLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

type Erro = { campo: string; mensagem: string }

/** Lê e valida os parâmetros da URL. Devolve os valores prontos para a consulta ou a resposta 422. */
export function lerFiltros(url: URL): z.infer<typeof consulta> | Response {
  const bruto: Record<string, string> = {}
  for (const [k, v] of url.searchParams) {
    if (k in bruto) return send(422, { error: 'Parâmetros inválidos.', erros: [{ campo: k, mensagem: 'Parâmetro repetido' }] })
    bruto[k] = v
  }
  const r = consulta.safeParse(bruto)
  if (!r.success) {
    const erros: Erro[] = r.error.issues.flatMap((i) =>
      i.code === 'unrecognized_keys' ? i.keys.map((k) => ({ campo: k, mensagem: 'Parâmetro desconhecido' })) : [{ campo: String(i.path[0] ?? 'parametros'), mensagem: i.message }],
    )
    return send(422, { error: 'Parâmetros inválidos.', erros })
  }
  const f = r.data
  if (f.pregao_de && f.pregao_ate && f.pregao_de > f.pregao_ate) return send(422, { error: 'Parâmetros inválidos.', erros: [{ campo: 'pregao_de', mensagem: 'A data inicial é depois da final' }] })
  if (f.valor_min !== undefined && f.valor_max !== undefined && f.valor_min > f.valor_max) return send(422, { error: 'Parâmetros inválidos.', erros: [{ campo: 'valor_min', mensagem: 'O valor mínimo é maior que o máximo' }] })
  return f
}

/** GET /api/externo/oportunidades: lista paginada (ordenada por id) com todos os campos de cada oportunidade. */
export async function listarParaLeitura(sql: Sql, url: URL): Promise<Response> {
  const f = lerFiltros(url)
  if (f instanceof Response) return f
  const limite = f.limite ?? LIMITE_PADRAO
  const offset = f.offset ?? 0
  const arquivadas = f.arquivadas === 'true' || f.arquivadas === '1'
  const q = f.q ? escaparLike(f.q) : null
  const orgao = f.orgao ? escaparLike(f.orgao) : null
  const analista = f.analista ? escaparLike(f.analista) : null
  const [r] = await sql`
    with f as (
      select o.* from oportunidades o
      where (${arquivadas}::boolean or (o.arquivado_em is null and not o.ausente_na_planilha))
        and (${q}::text is null or concat_ws(' ', o.codigo, o.sigla, o.orgao, o.processo, o.descritivo, o.objeto, o.uasg, o.analista, o.linha_servico) ilike '%' || ${q}::text || '%')
        and (${f.status ?? null}::text is null or lower(o.status) = lower(${f.status ?? null}::text))
        and (${f.torre ?? null}::text is null or lower(o.torre) = lower(${f.torre ?? null}::text))
        and (${f.uf ?? null}::text is null or lower(o.uf) = lower(${f.uf ?? null}::text))
        and (${f.linha_servico ?? null}::text is null or lower(o.linha_servico) = lower(${f.linha_servico ?? null}::text))
        and (${f.segmento ?? null}::text is null or lower(o.segmento) = lower(${f.segmento ?? null}::text))
        and (${analista}::text is null or o.analista ilike '%' || ${analista}::text || '%')
        and (${orgao}::text is null or o.orgao ilike '%' || ${orgao}::text || '%')
        and (${f.pregao_de ?? null}::date is null or o.data_pregao_dt >= ${f.pregao_de ?? null}::date)
        and (${f.pregao_ate ?? null}::date is null or o.data_pregao_dt <= ${f.pregao_ate ?? null}::date)
        and (${f.valor_min ?? null}::numeric is null or o.orcamento >= ${f.valor_min ?? null}::numeric)
        and (${f.valor_max ?? null}::numeric is null or o.orcamento <= ${f.valor_max ?? null}::numeric)
        and (${f.atualizado_desde ?? null}::timestamptz is null or o.atualizado_em >= ${f.atualizado_desde ?? null}::timestamptz)
    )
    select (select count(*) from f)::int as total,
           coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from (select * from f order by id limit ${limite}::int offset ${offset}::int) p), '[]'::jsonb) as itens`
  const total = Number(r?.total ?? 0)
  const itens = (r?.itens ?? []) as unknown[]
  return send(200, { total, limite, offset, proximo_offset: offset + limite < total ? offset + limite : null, itens })
}

/** GET /api/externo/oportunidades/{codigo}: uma oportunidade pelo código (AAAA-NNNN) ou pelo id numérico, com todos os campos. */
export async function obterParaLeitura(sql: Sql, codigo: string): Promise<Response> {
  const porId = /^\d{1,15}$/.test(codigo)
  if (!porId && !/^\d{4}-\d{1,8}$/.test(codigo)) return send(404, { error: 'Oportunidade não encontrada.' })
  const [r] = porId
    ? await sql`select to_jsonb(o) as r from oportunidades o where o.id = ${codigo}::bigint`
    : await sql`select to_jsonb(o) as r from oportunidades o where o.codigo = ${codigo}::text`
  return r ? send(200, r.r) : send(404, { error: 'Oportunidade não encontrada.' })
}
