import { send, erroBanco } from './http.ts'
import type { Sql } from './cadastro.ts'

const idValido = (v: string) => /^\d{1,15}$/.test(v)

export async function listarMonitoramento(sql: Sql) {
  const [{ rows }] = await sql`
    select m.id, m.oportunidade_id, m.portal, m.identificador_externo, m.url_oficial,
      m.habilitado, m.estado_vinculo, m.estado_coleta, m.ultima_tentativa_em,
      m.ultima_sucesso_em, m.proxima_coleta_em, m.ultimo_erro, m.atualizado_em,
      o.codigo, o.status, o.orgao, o.processo, o.descritivo, o.objeto, o.site,
      o.uasg, o.data_pregao_dt, o.analista,
      (select count(*)::int from monitor_licitacoes_eventos e where e.monitor_id=m.id) as total_eventos,
      (select count(*)::int from monitor_licitacoes_alertas a join monitor_licitacoes_eventos e on e.id=a.evento_id
       where e.monitor_id=m.id and a.estado in ('aberto','em_analise')) as alertas_abertos
    from monitor_licitacoes m join oportunidades o on o.id=m.oportunidade_id
    where o.arquivado_em is null
    order by case when m.habilitado then 0 else 1 end, m.proxima_coleta_em, o.data_pregao_dt nulls last, m.id desc
  `
  const [{ eventos }] = await sql`
    select coalesce(jsonb_agg(x order by x.detectado_em desc), '[]'::jsonb) as eventos
    from (
      select e.id, e.monitor_id, m.oportunidade_id, o.codigo, o.orgao, e.tipo, e.severidade,
        e.titulo, e.descricao, e.fonte, e.url_evidencia, e.classificacao, e.detectado_em,
        a.estado as estado_alerta
      from monitor_licitacoes_eventos e
      join monitor_licitacoes m on m.id=e.monitor_id
      join oportunidades o on o.id=m.oportunidade_id
      left join monitor_licitacoes_alertas a on a.evento_id=e.id
      where o.arquivado_em is null
      order by e.detectado_em desc limit 100
    ) x
  `
  const [{ resumo }] = await sql`
    select jsonb_build_object(
      'total', count(*)::int,
      'habilitados', count(*) filter (where m.habilitado)::int,
      'vinculados', count(*) filter (where m.estado_vinculo='vinculado')::int,
      'pendentes', count(*) filter (where m.estado_vinculo='pendente')::int,
      'falhas', count(*) filter (where m.estado_coleta='falha')::int,
      'alertas', (select count(*)::int from monitor_licitacoes_alertas where estado in ('aberto','em_analise'))
    ) as resumo
    from monitor_licitacoes m join oportunidades o on o.id=m.oportunidade_id
    where o.arquivado_em is null
  `
  return send(200, { rows, eventos, resumo })
}

export async function vincularMonitoramento(sql: Sql, email: string, rawId: string, corpo: unknown) {
  if (!idValido(rawId)) return send(404, { error: 'Oportunidade não encontrada.' })
  if (!corpo || typeof corpo !== 'object') return send(400, { error: 'Informe os dados do vínculo.' })
  const b = corpo as Record<string, unknown>
  const portal = b.portal
  const identificador = typeof b.identificador_externo === 'string' ? b.identificador_externo.trim() : ''
  const url = typeof b.url_oficial === 'string' ? b.url_oficial.trim() : ''
  const habilitado = b.habilitado !== false
  if (portal !== 'PNCP' && portal !== 'COMPRAS_GOV') return send(422, { error: 'Selecione PNCP ou Compras.gov.br.' })
  if (!identificador || identificador.length > 200) return send(422, { error: 'Informe o identificador oficial (até 200 caracteres).' })
  if (url && (!/^https?:\/\//i.test(url) || url.length > 1000)) return send(422, { error: 'A URL oficial precisa ser http(s) e ter até 1.000 caracteres.' })
  try {
    const [{ m }] = await sql`
      insert into monitor_licitacoes (oportunidade_id, portal, identificador_externo, url_oficial, habilitado,
        estado_vinculo, proxima_coleta_em, atualizado_em)
      select o.id, ${portal}, ${identificador}, ${url || null}, ${habilitado}, 'vinculado', now(), now()
      from oportunidades o where o.id=${rawId}::bigint and o.arquivado_em is null
      on conflict (oportunidade_id) do update set
        portal=excluded.portal, identificador_externo=excluded.identificador_externo,
        url_oficial=excluded.url_oficial, habilitado=excluded.habilitado,
        estado_vinculo=case when excluded.habilitado then 'vinculado' else 'pausado' end,
        proxima_coleta_em=now(), atualizado_em=now()
      returning to_jsonb(monitor_licitacoes) as m
    `
    if (!m) return send(404, { error: 'Oportunidade não encontrada ou arquivada.' })
    await sql`
      insert into monitor_licitacoes_auditoria (monitor_id, acao, por, detalhes)
      select ${m.id}, 'vinculo_atualizado', ${email},
        jsonb_build_object('portal', ${portal}, 'identificador_externo', ${identificador}, 'habilitado', ${habilitado})
    `
    return send(200, { monitoramento: m })
  } catch (e) {
    return erroBanco(e)
  }
}

export async function atualizarAlerta(sql: Sql, email: string, rawId: string, corpo: unknown) {
  if (!idValido(rawId)) return send(404, { error: 'Alerta não encontrado.' })
  const b = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  const estado = b.estado
  const observacao = typeof b.observacao === 'string' ? b.observacao.trim().slice(0, 2000) : null
  const responsavel = typeof b.responsavel === 'string' ? b.responsavel.trim().slice(0, 160) : null
  if (!['aberto','em_analise','resolvido','descartado'].includes(String(estado))) return send(422, { error: 'Estado de alerta inválido.' })
  try {
    const [{ a }] = await sql`
      update monitor_licitacoes_alertas set estado=${estado}, observacao=${observacao},
        responsavel=${responsavel}, atualizado_por=${email}, atualizado_em=now()
      where id=${rawId}::bigint
      returning to_jsonb(monitor_licitacoes_alertas.*) as a
    `
    return a ? send(200, { alerta: a }) : send(404, { error: 'Alerta não encontrado.' })
  } catch (e) {
    return erroBanco(e)
  }
}

type PncpCandidato = {
  numeroControlePNCP?: string
  numeroCompra?: string
  anoCompra?: number | string
  processo?: string
  objetoCompra?: string
  informacaoComplementar?: string
  dataPublicacaoPncp?: string
  dataEncerramentoProposta?: string
  modalidadeNome?: string
  situacaoCompraNome?: string
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string }
  unidadeOrgao?: { codigoUnidade?: string; nomeUnidade?: string; ufSigla?: string }
}
const normalizar = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim()
const tokens = (s: string) => new Set(normalizar(s).split(/\s+/).filter(t => t.length >= 4))
const similaridade = (a: string, b: string) => {
  const aa = tokens(a), bb = tokens(b)
  if (!aa.size || !bb.size) return 0
  let n = 0
  for (const t of aa) if (bb.has(t)) n++
  return n / Math.max(aa.size, bb.size)
}

/** Sugere possíveis vínculos; nunca vincula automaticamente, porque a API de propostas abertas não cobre todos os certames. */
export async function buscarCandidatosPncp(sql: Sql, rawId: string) {
  if (!idValido(rawId)) return send(404, { error: 'Oportunidade não encontrada.' })
  const [o] = await sql`
    select id, orgao, processo, uasg, descritivo, objeto, site, uf, data_pregao_dt
    from oportunidades where id=${rawId}::bigint and arquivado_em is null
  `
  if (!o) return send(404, { error: 'Oportunidade não encontrada ou arquivada.' })
  const fim = new Date()
  const dataFinal = `${fim.getFullYear()}${String(fim.getMonth()+1).padStart(2,'0')}${String(fim.getDate()).padStart(2,'0')}`
  const url = new URL('https://pncp.gov.br/api/consulta/v1/contratacoes/proposta')
  url.searchParams.set('dataFinal', dataFinal)
  url.searchParams.set('pagina', '1')
  url.searchParams.set('tamanhoPagina', '100')
  if (typeof o.uf === 'string' && /^[A-Za-z]{2}$/.test(o.uf)) url.searchParams.set('uf', o.uf.toUpperCase())
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Radar-PreVendas-Licitacoes/1.0' }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return send(502, { error: `PNCP respondeu HTTP ${res.status}; tente novamente mais tarde.` })
    const payload = await res.json() as { data?: PncpCandidato[]; items?: PncpCandidato[]; content?: PncpCandidato[]; resultado?: PncpCandidato[] }
    const lista = payload.data ?? payload.items ?? payload.content ?? payload.resultado ?? []
    const proc = normalizar(o.processo)
    const orgao = normalizar(o.orgao)
    const uasg = normalizar(o.uasg)
    const objeto = normalizar([o.objeto, o.descritivo].filter(Boolean).join(' '))
    const ranked = lista.map(c => {
      const controle = c.numeroControlePNCP ?? ''
      const partes = controle.match(/^(\d{14})-1-(\d+)\/(\d{4})$/)
      const urlOficial = partes ? `https://pncp.gov.br/app/editais/${partes[1]}/${partes[3]}/${partes[2]}` : null
      const procCand = normalizar(c.processo)
      const orgaoCand = normalizar(c.orgaoEntidade?.razaoSocial)
      const unidadeCand = normalizar([c.unidadeOrgao?.codigoUnidade, c.unidadeOrgao?.nomeUnidade].filter(Boolean).join(' '))
      const objetoCand = normalizar([c.objetoCompra, c.informacaoComplementar].filter(Boolean).join(' '))
      let score = 0
      const motivos: string[] = []
      if (proc && procCand && proc === procCand) { score += 100; motivos.push('Número do processo exato') }
      if (uasg && (unidadeCand.includes(uasg) || normalizar(c.unidadeOrgao?.codigoUnidade) === uasg)) { score += 60; motivos.push('UASG/unidade compatível') }
      if (orgao && orgaoCand && (orgaoCand.includes(orgao) || orgao.includes(orgaoCand))) { score += 35; motivos.push('Órgão compatível') }
      const sim = similaridade(objeto, objetoCand)
      if (sim >= 0.55) { score += Math.round(sim * 35); motivos.push('Objeto semelhante') }
      return { score, motivos, numeroControlePNCP: controle, numeroCompra: c.numeroCompra ?? null,
        processo: c.processo ?? null, objeto: c.objetoCompra ?? null, orgao: c.orgaoEntidade?.razaoSocial ?? null,
        unidade: c.unidadeOrgao?.nomeUnidade ?? null, uf: c.unidadeOrgao?.ufSigla ?? null,
        modalidade: c.modalidadeNome ?? null, situacao: c.situacaoCompraNome ?? null,
        dataPublicacaoPncp: c.dataPublicacaoPncp ?? null, dataEncerramentoProposta: c.dataEncerramentoProposta ?? null,
        urlOficial, portal: 'PNCP' as const }
    }).filter(c => c.score > 0).sort((a,b) => b.score - a.score).slice(0, 10)
    return send(200, { candidatos: ranked, consultados: lista.length, fonte: url.toString(),
      observacao: 'Busca de descoberta baseada em contratações com recebimento de propostas aberto. Não cobre necessariamente certames encerrados; confirme os dados antes de vincular.' })
  } catch (e) {
    console.error('Falha na busca de candidatos PNCP:', e instanceof Error ? e.message : e)
    return send(502, { error: 'Não foi possível consultar os candidatos no PNCP agora.' })
  }
}
