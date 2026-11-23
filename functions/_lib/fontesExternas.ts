/**
 * Consulta das fontes públicas de licitações (PNCP, Compras.gov.br) e dos boletins da ConLicitações.
 * Única implementação: as rotas /pncp, /comprasgov, /conlicitacao e /api/pncp/* só repassam para cá.
 * Somente leitura (GET), com identidade do Cloudflare Access e lista fechada de caminhos.
 * Nada do que é secreto (token, URL, corpo da resposta da fonte) vai para a resposta de erro.
 */
import { identificar, send, type Env } from './http.ts'

/** JSON de fonte externa, sem esquema garantido: cada campo é tratado como opcional. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>

export type EnvFontes = Env & { CONLICITACAO_TOKEN?: string }

const COMPRAS_ALLOWED = new Set([
  'modulo-legado/1_consultarLicitacao',
  'modulo-legado/3_consultarPregoes',
  'modulo-contratacoes/1_consultarContratacoes_PNCP_14133',
])
const PNCP_ALLOWED = 'consulta/v1/contratacoes/proposta'
const CONLICITACAO_BASE = 'https://consultaonline.conlicitacao.com.br/api'

/** Motivo técnico curto da falha na fonte (status HTTP ou tipo do erro de rede). Nunca inclui token, URL ou corpo da resposta. */
const motivoTecnico = (e: unknown) => {
  const x = (e ?? {}) as { status?: number; name?: string }
  return x.status ? `HTTP ${x.status}` : String(x.name ?? 'erro').slice(0, 40)
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/** Registro de um boletim da ConLicitações no formato que o front-end já consome (campos do PNCP). */
export function mapearItemConlicitacao(item: Obj, filtro: Obj, boletimId: unknown) {
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
}

const erroConlicitacao = (status: number, reason: unknown, mensagemGenerica: string) =>
  json({
    error: status === 403 ? 'ConLicitações recusou a origem da consulta (IP não autorizado).' : status === 401 ? 'ConLicitações recusou a credencial configurada.' : mensagemGenerica,
    fonte: 'ConLicitações', retryable: status >= 500, motivo: motivoTecnico(reason),
  }, status)

async function consultarConlicitacao(token: string): Promise<Response> {
  const get = async (endpoint: string) => {
    const response = await fetch(CONLICITACAO_BASE + endpoint, {
      headers: { accept: 'application/json', 'X-AUTH-TOKEN': token },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw Object.assign(new Error('ConLicitações respondeu HTTP ' + response.status), { status: response.status })
    return response.json() as Promise<Obj>
  }
  const statusDe = (e: unknown) => {
    const s = (e as { status?: number } | undefined)?.status
    return s === 401 || s === 403 ? s : 502
  }
  try {
    const catalogo = await get('/filtros')
    const filtros: Obj[] = Array.isArray(catalogo.filtros) ? catalogo.filtros : []
    const boletins = await Promise.allSettled(filtros.map(async (filtro) => {
      const boletimId = filtro?.ultimo_boletim?.id
      if (boletimId == null) return []
      const boletim = await get('/boletim/' + encodeURIComponent(String(boletimId)) + '?page=1&per_page=100')
      const itens = [...(Array.isArray(boletim.licitacoes) ? boletim.licitacoes : []), ...(Array.isArray(boletim.acompanhamentos) ? boletim.acompanhamentos : [])]
      return itens.map((item) => mapearItemConlicitacao(item, filtro, boletimId))
    }))
    const falhas = boletins.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    const registros = boletins.filter((r): r is PromiseFulfilledResult<ReturnType<typeof mapearItemConlicitacao>[]> => r.status === 'fulfilled').flatMap((r) => r.value)
    if (!registros.length && falhas.length) return erroConlicitacao(statusDe(falhas[0].reason), falhas[0].reason, 'Não foi possível ler os boletins da ConLicitações.')
    return json({ resultado: registros, total: registros.length, filtrosConsultados: filtros.length, filtrosComFalha: falhas.length, fonte: 'ConLicitações' })
  } catch (error) {
    return erroConlicitacao(statusDe(error), error, 'Não foi possível consultar a ConLicitações agora.')
  }
}

/**
 * Atende uma consulta. `caminho` é o que vem depois do prefixo da rota:
 * `consulta/v1/contratacoes/proposta` (PNCP), `comprasgov/<endpoint>` (Compras.gov.br) ou `conlicitacao`.
 */
export async function atenderFonteExterna(request: Request, env: EnvFontes, caminho: string): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Método não permitido.' }, { status: 405, headers: { allow: 'GET', 'cache-control': 'private, no-store' } })
  }
  // Mesma guarda das demais rotas: só passa com a identidade do Cloudflare Access (e falha fechada sem a configuração dele).
  const id = await identificar(request, env)
  if (id instanceof Response) return id

  if (caminho === 'conlicitacao') {
    if (!env.CONLICITACAO_TOKEN) return json({ error: 'ConLicitações ainda não está configurado no ambiente seguro.', fonte: 'ConLicitações', retryable: false }, 503)
    return consultarConlicitacao(env.CONLICITACAO_TOKEN)
  }

  const comprasGov = caminho.startsWith('comprasgov/')
  const destino = comprasGov ? caminho.slice('comprasgov/'.length) : caminho
  const permitido = comprasGov ? COMPRAS_ALLOWED.has(destino) : destino === PNCP_ALLOWED
  if (!permitido) return send(404, { error: 'Rota de consulta não permitida.' })

  const target = new URL(destino, comprasGov ? 'https://dadosabertos.compras.gov.br/' : 'https://pncp.gov.br/api/')
  new URL(request.url).searchParams.forEach((value, key) => target.searchParams.set(key, value))

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(comprasGov ? 20_000 : 12_000),
    })
    const headers = new Headers()
    headers.set('content-type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
    headers.set('cache-control', 'private, max-age=60')
    headers.set('x-radar-source', comprasGov ? 'compras-gov-dados-abertos' : 'pncp')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return json({
      error: comprasGov ? 'Não foi possível consultar o Compras.gov.br agora.' : 'Não foi possível consultar o PNCP agora.',
      fonte: comprasGov ? 'Compras.gov.br' : 'PNCP',
      retryable: true,
    }, 502)
  }
}

/** Parâmetro `path` das rotas do Cloudflare Pages (`[[path]]`) -> caminho com barras. */
export const caminhoDe = (path?: string | string[]) => [path].flat().filter(Boolean).join('/')
