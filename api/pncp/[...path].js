const COMPRAS_ALLOWED = new Set([
  'modulo-legado/1_consultarLicitacao',
  'modulo-legado/3_consultarPregoes',
  'modulo-contratacoes/1_consultarContratacoes_PNCP_14133',
])

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).send('Método não permitido')
  }

  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean)
  const path = segments.join('/')
  if (path === 'conlicitacao') {
    const token = process.env.CONLICITACAO_TOKEN
    if (!token) return res.status(503).json({ error: 'ConLicitações ainda não está configurado no ambiente seguro.', fonte: 'ConLicitações', retryable: false })
    const base = 'https://consulteonline.conlicitacao.com.br/api'
    const get = async (endpoint) => {
      const response = await fetch(base + endpoint, {
        headers: { accept: 'application/json', 'X-AUTH-TOKEN': token },
        signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) {
        const error = new Error('ConLicitações respondeu HTTP ' + response.status)
        error.status = response.status
        throw error
      }
      return response.json()
    }
    try {
      const catalogo = await get('/filtros')
      const filtros = Array.isArray(catalogo.filtros) ? catalogo.filtros : []
      const boletins = await Promise.allSettled(filtros.map(async (filtro) => {
        const boletimId = filtro.ultimo_boletim && filtro.ultimo_boletim.id
        if (boletimId == null) return []
        const boletim = await get('/boletim/' + encodeURIComponent(String(boletimId)) + '?page=1&per_page=100')
        const orgaoPadrao = {}
        return [...(boletim.licitacoes || []), ...(boletim.acompanhamentos || [])].map((item) => {
          const orgao = item.orgao && typeof item.orgao === 'object' ? item.orgao : orgaoPadrao
          const modalidade = item.modalidade && typeof item.modalidade === 'object' ? item.modalidade.descricao : item.modalidade
          return {
            processo: item.edital || item.numero || '',
            numeroCompra: item.edital || item.numero || '',
            objetoCompra: item.objeto || item.objeto_resumido || '',
            informacaoComplementar: item.observacao || item.documento || '',
            dataPublicacaoPncp: item.datahora_publicacao || item.data_publicacao || '',
            dataEncerramentoProposta: item.datahora_abertura || item.data_abertura || '',
            modalidadeNome: modalidade || 'Licitação',
            situacaoCompraNome: item.situacao || 'Não informada',
            orgaoEntidade: { razaoSocial: orgao.nome || (typeof item.orgao === 'string' ? item.orgao : '') },
            unidadeOrgao: { nomeUnidade: orgao.cidade || '', ufSigla: orgao.uf || item.uf || '' },
            valor_estimado_total: item.valor_estimado,
            numeroControlePNCP: 'conlicitacao-' + String(item.id || item.edital || boletimId),
            source: 'ConLicitações · ' + String(filtro.descricao || 'Boletim'),
            filtro: filtro.descricao || '',
            url: item.url || item.link || '',
          }
        })
      }))
      const falhas = boletins.filter((r) => r.status === 'rejected')
      const registros = boletins.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
      if (!registros.length && falhas.length) {
        const first = falhas[0].reason
        const status = first && first.status === 403 ? 403 : first && first.status === 401 ? 401 : 502
        return res.status(status).json({ error: status === 403 ? 'ConLicitações recusou a origem da consulta (IP não autorizado).' : status === 401 ? 'ConLicitações recusou a credencial configurada.' : 'Não foi possível ler os boletins da ConLicitações.', fonte: 'ConLicitações', retryable: status >= 500 })
      }
      return res.status(200).json({ resultado: registros, total: registros.length, filtrosConsultados: filtros.length, filtrosComFalha: falhas.length, fonte: 'ConLicitações' })
    } catch (error) {
      const status = error && error.status === 401 ? 401 : error && error.status === 403 ? 403 : 502
      return res.status(status).json({ error: status === 403 ? 'ConLicitações recusou a origem da consulta (IP não autorizado).' : status === 401 ? 'ConLicitações recusou a credencial configurada.' : 'Não foi possível consultar a ConLicitações agora.', fonte: 'ConLicitações', retryable: status >= 500 })
    }
  }

  const isComprasGov = path.startsWith('comprasgov/')
  const upstreamPath = isComprasGov ? path.slice('comprasgov/'.length) : path
  const allowed = isComprasGov
    ? COMPRAS_ALLOWED.has(upstreamPath)
    : upstreamPath === 'consulta/v1/contratacoes/proposta'
  if (!allowed) return res.status(404).send('Rota de consulta não permitida')

  const base = isComprasGov ? 'https://dadosabertos.compras.gov.br/' : 'https://pncp.gov.br/api/'
  const target = new URL(base + upstreamPath)
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path' || value === undefined) continue
    for (const entry of Array.isArray(value) ? value : [value]) target.searchParams.append(key, String(entry))
  }
  try {
    const upstream = await fetch(target, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(isComprasGov ? 20000 : 12000),
    })
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60')
    const body = await upstream.text()
    return res.status(upstream.status).send(body)
  } catch {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(502).json({
      error: isComprasGov ? 'Não foi possível consultar o Compras.gov.br agora.' : 'Não foi possível consultar o PNCP agora.',
      fonte: isComprasGov ? 'Compras.gov.br' : 'PNCP',
      retryable: true,
    })
  }
}
