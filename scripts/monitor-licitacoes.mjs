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
    const match = String(value).match(/(?:orgaos\/)?(\d{14})\/compras\/(\d{4})\/(\d+)/i)
    if (match) return { cnpj: match[1], ano: match[2], sequencial: match[3] }
    const simple = String(value).match(/^(\d{14})[\s/;-]+(\d{4})[\s/;-]+(\d+)$/)
    if (simple) return { cnpj: simple[1], ano: simple[2], sequencial: simple[3] }
  }
  return null
}
async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Radar-PreVendas-Licitacoes/1.0' }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Fonte oficial respondeu HTTP ${res.status}`)
  return res.json()
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
  let ok = 0, falhas = 0, ignorados = 0
  for (const m of due) {
    const [{ id: coletaId }] = await sql`
      insert into monitor_licitacoes_coletas (monitor_id, portal, resultado)
      values (${m.id}, ${m.portal || 'DESCONHECIDO'}, 'em_andamento') returning id
    `
    try {
      if (m.portal !== 'PNCP') {
        const detalhe = 'Conector desta fonte ainda não habilitado nesta etapa. O vínculo foi preservado; nenhuma ausência de mudança foi inferida.'
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
      if (!ref) throw new Error('Identificador PNCP inválido. Use CNPJ do órgão/ano/sequencial ou URL oficial com /orgaos/{CNPJ}/compras/{ano}/{sequencial}.')
      const url = `https://pncp.gov.br/api/consulta/v1/orgaos/${ref.cnpj}/compras/${ref.ano}/${ref.sequencial}`
      const payload = await fetchJson(url)
      const contentHash = hash(payload)
      const [{ snapshot_id: snapshotId }] = await sql`
        insert into monitor_licitacoes_snapshots
          (monitor_id, portal, tipo_registro, chave_registro, dados, hash_conteudo, url_evidencia, publicado_em)
        values (${m.id}, 'PNCP', 'contratacao', ${`${ref.cnpj}/${ref.ano}/${ref.sequencial}`},
          ${JSON.stringify(payload)}::jsonb, ${contentHash}, ${url}, null)
        on conflict (monitor_id, chave_registro, hash_conteudo) do nothing
        returning id as snapshot_id
      `
      if (snapshotId) {
        const [prev] = await sql`
          select id, hash_conteudo from monitor_licitacoes_snapshots
          where monitor_id=${m.id} and chave_registro=${`${ref.cnpj}/${ref.ano}/${ref.sequencial}`}
            and hash_conteudo <> ${contentHash}
          order by observado_em desc limit 1
        `
        if (prev) {
          const dedupeKey = `pncp:${m.id}:${contentHash}`
          const [{ eventoId }] = await sql`
            insert into monitor_licitacoes_eventos
              (monitor_id, snapshot_id, tipo, severidade, titulo, descricao, fonte, url_evidencia, classificacao, dedupe_key)
            values (${m.id}, ${snapshotId}, 'alteracao_contratacao', 'atencao',
              'Informações da contratação foram alteradas',
              'A resposta da contratação na API oficial do PNCP difere da última observação salva. Revise os campos e a evidência antes de tomar uma decisão.',
              'PNCP API Consulta', ${url}, 'detectado_comparacao', ${dedupeKey})
            on conflict (dedupe_key) do nothing returning id as "eventoId"
          `
          if (eventoId) await sql`insert into monitor_licitacoes_alertas (evento_id) values (${eventoId}) on conflict (evento_id) do nothing`
        }
      }
      await sql`
        update monitor_licitacoes set estado_coleta='ok', ultima_tentativa_em=now(), ultima_sucesso_em=now(),
          proxima_coleta_em=now()+interval '30 minutes', ultimo_erro=null, atualizado_em=now()
        where id=${m.id}
      `
      await sql`update monitor_licitacoes_coletas set finalizada_em=now(), resultado='ok', registros_lidos=1 where id=${coletaId}`
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
  console.log(JSON.stringify({ executado_em: agora.toISOString(), encontrados: due.length, sucesso: ok, falhas, aguardando_conector: ignorados }))
  if (falhas) process.exitCode = 1
}
await main()
