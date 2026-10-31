import { createHash } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_URL_MONITOR
if (!databaseUrl) {
  console.error('DATABASE_URL_MONITOR não configurada; rotina encerrada sem executar consultas.')
  process.exit(1)
}
const sql = neon(databaseUrl)
const agora = new Date()
const maxItens = Math.max(1, Math.min(Number(process.env.MONITOR_BATCH_SIZE || 30), 100))

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function pncpRef(m) {
  const candidates = [m.identificador_externo, m.url_oficial].filter(Boolean)
  for (const value of candidates) {
    const text = String(value)
    // Canonical official REST path /orgaos/{CNPJ}/compras/{ano}/{sequencial}
    let match = text.match(/(?:orgaos\/)?(\d{14})\/compras\/(\d{4})\/(\d+)/i)
    if (match) return { cnpj: match[1], ano: match[2], sequencial: match[3] }
    // PNCP identifier displayed in the portal: CNPJ-modality-sequence/year
    match = text.match(/(\d{14})-(\d+)-(\d+)\/(\d{4})/)
    if (match) return { cnpj: match[1], ano: match[4], sequencial: match[3] }
    // Canonical public page /app/editais/{CNPJ}/{ano}/{sequencial}
    match = text.match(/\/app\/editais\/(\d{14})\/(\d{4})\/(\d+)/i)
    if (match) return { cnpj: match[1], ano: match[2], sequencial: match[3] }
    // Compact CNPJ/year/sequence form
    match = text.match(/^(\d{14})[\s/;-]+(\d{4})[\s/;-]+(\d+)$/)
    if (match) return { cnpj: match[1], ano: match[2], sequencial: match[3] }
  }
  return null
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Radar-PreVendas-Licitacoes/1.0' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Fonte oficial respondeu HTTP ${res.status} em ${new URL(url).pathname}`)
  return res.json()
}
async function fetchPaginatedJson(url, maxPages = 10) {
  const first = new URL(url)
  first.searchParams.set('pagina', '1')
  first.searchParams.set('tamanhoPagina', '100')
  const initial = await fetchJson(first.toString())
  if (Array.isArray(initial)) return { dados: initial, parcial: false }
  const getRows = (p) => Array.isArray(p?.data) ? p.data : Array.isArray(p?.items) ? p.items : Array.isArray(p?.content) ? p.content : Array.isArray(p?.resultado) ? p.resultado : null
  const rows = getRows(initial)
  if (!rows) return { dados: initial, parcial: false }
  const total = Number(initial.totalPaginas ?? initial.totalPages ?? initial.total_pages ?? 1)
  const pages = Math.max(1, Math.min(Number.isFinite(total) ? total : 1, maxPages))
  const all = [...rows]
  for (let pagina = 2; pagina <= pages; pagina++) {
    const next = new URL(url)
    next.searchParams.set('pagina', String(pagina))
    next.searchParams.set('tamanhoPagina', '100')
    const payload = await fetchJson(next.toString())
    const more = getRows(payload)
    if (!more) throw new Error('Resposta paginada do PNCP sem lista de registros esperada.')
    all.push(...more)
  }
  return {
    dados: { ...initial, data: all, totalRegistrosColetados: all.length },
    parcial: total > maxPages,
  }
}
async function salvarSnapshot(m, registro, urlBase) {
  const contentHash = hash(registro.dados)
  const [{ snapshot_id: snapshotId }] = await sql`
    insert into monitor_licitacoes_snapshots
      (monitor_id, portal, tipo_registro, chave_registro, dados, hash_conteudo, url_evidencia, publicado_em)
    values (${m.id}, 'PNCP', ${registro.tipo}, ${registro.chave},
      ${JSON.stringify(registro.dados)}::jsonb, ${contentHash}, ${registro.url}, null)
    on conflict (monitor_id, chave_registro, hash_conteudo) do nothing
    returning id as snapshot_id
  `
  if (!snapshotId) return { alterado: false }
  const [prev] = await sql`
    select id from monitor_licitacoes_snapshots
    where monitor_id=${m.id} and chave_registro=${registro.chave} and hash_conteudo <> ${contentHash}
    order by observado_em desc limit 1
  `
  if (!prev) return { alterado: false }
  const dedupeKey = `pncp:${m.id}:${registro.chave}:${contentHash}`
  const [{ eventoId } = {}] = await sql`
    insert into monitor_licitacoes_eventos
      (monitor_id, snapshot_id, tipo, severidade, titulo, descricao, fonte, url_evidencia, classificacao, dedupe_key)
    values (${m.id}, ${snapshotId}, 'alteracao_${registro.tipo}', 'atencao',
      ${registro.titulo},
      ${registro.descricao},
      'PNCP API Consulta', ${registro.url || urlBase}, 'detectado_comparacao', ${dedupeKey})
    on conflict (dedupe_key) do nothing returning id as "eventoId"
  `
  if (eventoId) await sql`insert into monitor_licitacoes_alertas (evento_id) values (${eventoId}) on conflict (evento_id) do nothing`
  return { alterado: true }
}
async function main() {
  const due = await sql`
    select m.id, m.oportunidade_id, m.portal, m.identificador_externo, m.url_oficial
    from monitor_licitacoes m
    join oportunidades o on o.id=m.oportunidade_id
    where m.habilitado and m.estado_vinculo='vinculado'
      and m.proxima_coleta_em <= now()
      and o.arquivado_em is null
    order by m.proxima_coleta_em, m.id
    limit ${maxItens}
  `
  let ok = 0, falhas = 0, ignorados = 0, snapshots = 0, eventos = 0
  for (const m of due) {
    const [{ id: coletaId }] = await sql`
      insert into monitor_licitacoes_coletas (monitor_id, portal, resultado)
      values (${m.id}, ${m.portal || 'DESCONHECIDO'}, 'em_andamento') returning id
    `
    try {
      if (m.portal !== 'PNCP') {
        const detalhe = 'O conector automático desta fonte ainda não está habilitado. O vínculo foi preservado; nenhuma ausência de mudança foi inferida.'
        await sql`
          update monitor_licitacoes set estado_coleta='sem_dados', ultima_tentativa_em=now(),
            ultimo_erro=${detalhe}, proxima_coleta_em=now()+interval '1 day', atualizado_em=now()
          where id=${m.id}
        `
        await sql`update monitor_licitacoes_coletas set finalizada_em=now(), resultado='sem_dados', detalhe=${detalhe} where id=${coletaId}`
        ignorados++
        continue
      }
      const ref = pncpRef(m)
      if (!ref) throw new Error('Identificador PNCP não reconhecido. Informe CNPJ/ano/sequencial ou URL/ID oficial do PNCP.')
      const root = `https://pncp.gov.br/api/consulta/v1/orgaos/${ref.cnpj}/compras/${ref.ano}/${ref.sequencial}`
      const baseKey = `${ref.cnpj}/${ref.ano}/${ref.sequencial}`
      const contratoUrl = root
      const itensUrl = `${root}/itens`
      const historicoUrl = `${root}/historico`
      // Contratação é a linha de base principal; itens e histórico são registros independentes.
      const contrato = await fetchJson(contratoUrl)
      const registros = [{
        tipo: 'contratacao', chave: `${baseKey}:contratacao`, dados: contrato, url: contratoUrl,
        titulo: 'Dados gerais da contratação alterados',
        descricao: 'A resposta da contratação na API oficial do PNCP difere da última observação. Revise os campos alterados e a evidência oficial.',
      }]
      // Falhas em itens/histórico não invalidam uma contratação consultada com sucesso.
      const falhasParciais = []
      for (const extra of [
        { tipo: 'itens', url: itensUrl, paginado: true, titulo: 'Itens da contratação alterados', descricao: 'A lista de itens publicada pelo PNCP difere da última observação.' },
        { tipo: 'historico', url: historicoUrl, titulo: 'Histórico oficial da contratação alterado', descricao: 'O histórico de eventos da contratação no PNCP difere da última observação.' },
      ]) {
        try {
          const resposta = extra.paginado ? await fetchPaginatedJson(extra.url) : { dados: await fetchJson(extra.url), parcial: false }
          registros.push({ ...extra, chave: `${baseKey}:${extra.tipo}`, dados: resposta.dados })
          if (resposta.parcial) falhasParciais.push(`${extra.tipo}: paginação limitada ao máximo de páginas por coleta`)
        } catch (e) {
          falhasParciais.push(`${extra.tipo}: ${e instanceof Error ? e.message : 'falha desconhecida'}`)
        }
      }
      for (const registro of registros) {
        const resultado = await salvarSnapshot(m, registro, contratoUrl)
        snapshots++
        if (resultado.alterado) eventos++
      }
      const status = falhasParciais.length ? 'parcial' : 'ok'
      const detalhe = falhasParciais.length ? falhasParciais.join('; ').slice(0, 1000) : null
      await sql`
        update monitor_licitacoes set estado_coleta=${status}, ultima_tentativa_em=now(), ultima_sucesso_em=now(),
          proxima_coleta_em=now()+interval '30 minutes', ultimo_erro=${detalhe}, atualizado_em=now()
        where id=${m.id}
      `
      await sql`
        update monitor_licitacoes_coletas set finalizada_em=now(), resultado=${status},
          registros_lidos=${registros.length}, detalhe=${detalhe}
        where id=${coletaId}
      `
      ok++
    } catch (e) {
      const detalhe = (e instanceof Error ? e.message : 'Falha desconhecida').slice(0, 1000)
      await sql`
        update monitor_licitacoes set estado_coleta='falha', ultima_tentativa_em=now(),
          proxima_coleta_em=now()+interval '15 minutes', ultimo_erro=${detalhe}, atualizado_em=now()
        where id=${m.id}
      `
      await sql`update monitor_licitacoes_coletas set finalizada_em=now(), resultado='falha', detalhe=${detalhe} where id=${coletaId}`
      console.error(`Falha no monitor ${m.id} (oportunidade ${m.oportunidade_id}): ${detalhe}`)
      falhas++
    }
  }
  console.log(JSON.stringify({ executado_em: agora.toISOString(), encontrados: due.length, sucesso: ok, falhas, aguardando_conector: ignorados, snapshots, eventos }))
  if (falhas) process.exitCode = 1
}
await main()
