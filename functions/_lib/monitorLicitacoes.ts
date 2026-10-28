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
      returning to_jsonb(monitor_licitacoes.*) as m
    `
    if (!m) return send(404, { error: 'Oportunidade não encontrada ou arquivada.' })
    await sql`
      insert into oportunidades_historico (oportunidade_id, versao, acao, por, alteracoes)
      select ${rawId}::bigint, o.versao, 'vinculo_monitoramento', ${email},
        jsonb_build_object('portal', ${portal}, 'identificador_externo', ${identificador}, 'habilitado', ${habilitado})
      from oportunidades o where o.id=${rawId}::bigint
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
