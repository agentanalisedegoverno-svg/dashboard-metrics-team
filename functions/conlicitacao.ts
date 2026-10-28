type Env = { CONLICITACAO_TOKEN?: string }
type Context = { request: Request; env: Env }
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } })

/** Consulta somente leitura dos boletins associados à conta ConLicitações. */
export const onRequestGet = async ({ env }: Context): Promise<Response> => {
  const token = env.CONLICITACAO_TOKEN
  if (!token) return json(503, { error: 'ConLicitações ainda não está configurado no ambiente seguro.', fonte: 'ConLicitações', retryable: false })
  const base = 'https://consulteonline.conlicitacao.com.br/api'
  const get = async (endpoint: string) => {
    const response = await fetch(base + endpoint, {
      headers: { accept: 'application/json', 'X-AUTH-TOKEN': token },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status })
    return response.json() as Promise<Record<string, any>>
  }
  try {
    const catalogo = await get('/filtros')
    const filtros = Array.isArray(catalogo.filtros) ? catalogo.filtros : []
    const boletins = await Promise.allSettled(filtros.map(async (filtro: any) => {
      const id = filtro?.ultimo_boletim?.id
      if (id == null) return []
      const boletim = await get('/boletim/' + encodeURIComponent(String(id)) + '?page=1&per_page=100')
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
          numeroControlePNCP: 'conlicitacao-' + String(item.id || item.edital || id),
          source: 'ConLicitações · ' + String(filtro.descricao || 'Boletim'),
          filtro: filtro.descricao || '',
          url: item.url || item.link || '',
        }
      })
    }))
    const falhas = boletins.filter((r) => r.status === 'rejected')
    const registros = boletins.filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled').flatMap((r) => r.value)
    if (!registros.length && falhas.length) {
      const status = (falhas[0] as PromiseRejectedResult).reason?.status
      return json(status === 401 || status === 403 ? status : 502, {
        error: status === 403 ? 'ConLicitações recusou a origem da consulta (IP não autorizado).' : status === 401 ? 'ConLicitações recusou a credencial configurada.' : 'Não foi possível ler os boletins da ConLicitações.',
        fonte: 'ConLicitações', retryable: ![401, 403].includes(status),
      })
    }
    return json(200, { resultado: registros, total: registros.length, filtrosConsultados: filtros.length, filtrosComFalha: falhas.length, fonte: 'ConLicitações' })
  } catch (error: any) {
    const status = error?.status === 401 || error?.status === 403 ? error.status : 502
    return json(status, { error: status === 403 ? 'ConLicitações recusou a origem da consulta (IP não autorizado).' : status === 401 ? 'ConLicitações recusou a credencial configurada.' : 'Não foi possível consultar a ConLicitações agora.', fonte: 'ConLicitações', retryable: status >= 500 })
  }
}

export const onRequest = ({ request }: Context) => request.method === 'GET'
  ? new Response(null, { status: 405, headers: { allow: 'GET' } })
  : new Response('Método não permitido', { status: 405, headers: { allow: 'GET' } })
