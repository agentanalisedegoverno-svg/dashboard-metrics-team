import { identificar, send, type Env } from '../../_lib/http.ts'

type Context = { request: Request; params: { path?: string | string[] }; env: Env & { CONLICITACAO_TOKEN?: string } }

const COMPRAS_ALLOWED = new Set([
  'modulo-legado/1_consultarLicitacao',
  'modulo-legado/3_consultarPregoes',
  'modulo-contratacoes/1_consultarContratacoes_PNCP_14133',
])

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } })

/**
 * Rotas que o front-end chama como /api/pncp/*.
 * No Cloudflare Pages, functions/api/[[path]].ts captura /api/* antes de
 * qualquer arquivo Vercel em /api. Esta rota específica precisa existir para
 * que /api/pncp/* não caia no handler genérico de API do Radar.
 */
export const onRequest = async ({ request, params, env }: Context): Promise<Response> => {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Método não permitido.' }, { status: 405, headers: { allow: 'GET', 'cache-control': 'private, no-store' } })
  }
  // Mesma guarda das demais rotas: só passa com a identidade do Cloudflare Access (e falha fechada sem a configuração dele).
  const id = await identificar(request, env)
  if (id instanceof Response) return id

  const path = [params.path].flat().filter(Boolean).join('/')
  const incoming = new URL(request.url)

  if (path === 'conlicitacao') {
    const token = env.CONLICITACAO_TOKEN
    if (!token) {
      return json({ error: 'ConLicitações ainda não está configurado no ambiente seguro.', fonte: 'ConLicitações', retryable: false }, 503)
    }

    const base = 'https://consulteonline.conlicitacao.com.br/api'
    const get = async (endpoint: string) => {
      const response = await fetch(base + endpoint, {
        headers: { accept: 'application/json', 'X-AUTH-TOKEN': token },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) {
        const error = new Error('ConLicitações respondeu HTTP ' + response.status) as Error & { status?: number }
        error.status = response.status
        throw error
      }
      return response.json() as Promise<Record<string, any>>
    }

    try {
      const catalogo = await get('/filtros')
      const filtros = Array.isArray(catalogo.filtros) ? catalogo.filtros : []
      const boletins = await Promise.allSettled(filtros.map(async (filtro: any) => {
        const boletimId = filtro?.ultimo_boletim?.id
        if (boletimId == null) return []
        const boletim = await get('/boletim/' + encodeURIComponent(String(boletimId)) + '?page=1&per_page=100')
        return [...(Array.isArray(boletim.licitacoes) ? boletim.licitacoes : []), ...(Array.isArray(boletim.acompanhamentos) ? boletim.acompanhamentos : [])].map((item: any) => {
          const orgao = item.orgao && typeof item.orgao === 'object' ? item.orgao : {}
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
        const first = falhas[0].reason as { status?: number } | undefined
        const status = first?.status === 403 ? 403 : first?.status === 401 ? 401 : 502
        return json({
          error: status === 403 ? 'ConLicitações recusou a origem da consulta (IP não autorizado).' : status === 401 ? 'ConLicitações recusou a credencial configurada.' : 'Não foi possível ler os boletins da ConLicitações.',
          fonte: 'ConLicitações', retryable: status >= 500,
        }, status)
      }
      return json({ resultado: registros, total: registros.length, filtrosConsultados: filtros.length, filtrosComFalha: falhas.length, fonte: 'ConLicitações' })
    } catch (error) {
      const status = (error as { status?: number })?.status
      const code = status === 403 ? 403 : status === 401 ? 401 : 502
      return json({
        error: code === 403 ? 'ConLicitações recusou a origem da consulta (IP não autorizado).' : code === 401 ? 'ConLicitações recusou a credencial configurada.' : 'Não foi possível consultar a ConLicitações agora.',
        fonte: 'ConLicitações', retryable: code >= 500,
      }, code)
    }
  }

  const isComprasGov = path.startsWith('comprasgov/')
  const upstreamPath = isComprasGov ? path.slice('comprasgov/'.length) : path
  const allowed = isComprasGov
    ? COMPRAS_ALLOWED.has(upstreamPath)
    : upstreamPath === 'consulta/v1/contratacoes/proposta'
  if (!allowed) return send(404, { error: 'Rota de consulta não permitida.' })

  const base = isComprasGov ? 'https://dadosabertos.compras.gov.br/' : 'https://pncp.gov.br/api/'
  const target = new URL(upstreamPath, base)
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value))

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(isComprasGov ? 20_000 : 12_000),
    })
    const headers = new Headers()
    headers.set('content-type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
    headers.set('cache-control', 'private, max-age=60')
    headers.set('x-radar-source', isComprasGov ? 'compras-gov-dados-abertos' : 'pncp')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return json({
      error: isComprasGov ? 'Não foi possível consultar o Compras.gov.br agora.' : 'Não foi possível consultar o PNCP agora.',
      fonte: isComprasGov ? 'Compras.gov.br' : 'PNCP',
      retryable: true,
    }, 502)
  }
}
