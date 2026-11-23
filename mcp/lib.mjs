// Núcleo do servidor MCP do Radar Pré-Vendas: cliente HTTP SOMENTE LEITURA da API de leitura e as ferramentas.
// Sem dependências (o SDK do MCP só entra em server.mjs), para poder ser testado sem rede.
//
// Garantias: só faz GET; a chave nunca aparece em mensagem de erro nem em log; exige HTTPS (exceto localhost, para testes).

export const URL_PADRAO = 'https://radar-prevendas.pages.dev/api/externo'
/** Para o agente não estourar o contexto: padrão menor que o da API (100) e teto de 100 (a API aceita até 500). */
export const LIMITE_PADRAO = 25
export const LIMITE_MAXIMO = 100
const CHAVE_OK = /^rdr_[A-Za-z0-9_-]{20,80}$/
const CODIGO_OK = /^(\d{1,15}|\d{4}-\d{1,8})$/

export class ErroRadar extends Error {
  constructor(mensagem, status) {
    super(mensagem)
    this.name = 'ErroRadar'
    this.status = status
  }
}

/** Valida a configuração e devolve `{ baseUrl, chave }` ou lança com a explicação (sem ecoar a chave). */
export function lerConfig(env) {
  const chave = (env.RADAR_API_KEY ?? '').trim()
  if (!chave) throw new ErroRadar('Defina RADAR_API_KEY com uma chave de LEITURA do Radar (Administração → API).')
  if (!CHAVE_OK.test(chave)) throw new ErroRadar('RADAR_API_KEY não tem o formato de uma chave do Radar (rdr_...).')
  let base
  try {
    base = new URL((env.RADAR_API_URL ?? URL_PADRAO).trim().replace(/\/+$/, ''))
  } catch {
    throw new ErroRadar('RADAR_API_URL não é uma URL válida.')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) throw new ErroRadar('RADAR_API_URL deve usar https (http só em localhost).')
  if (base.username || base.password) throw new ErroRadar('RADAR_API_URL não pode conter usuário e senha.')
  return { baseUrl: base.toString().replace(/\/+$/, ''), chave }
}

/** Cliente da API: apenas `get`. Não existe método de escrita de propósito. */
export function criarCliente({ baseUrl, chave, fetchImpl = fetch, timeoutMs = 20_000 }) {
  return {
    async get(caminho, params = {}) {
      const url = new URL(baseUrl + caminho)
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
      let resposta
      try {
        resposta = await fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${chave}`, 'user-agent': 'radar-prevendas-mcp/1' },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error', // um redirecionamento (ex.: tela de login do Access) nunca recebe a chave
        })
      } catch (e) {
        throw new ErroRadar(e?.name === 'TimeoutError' ? 'O Radar demorou demais para responder.' : 'Não foi possível falar com o Radar (rede ou endereço).')
      }
      const texto = await resposta.text()
      let corpo = null
      try {
        corpo = texto ? JSON.parse(texto) : null
      } catch {
        /* resposta que não é JSON */
      }
      if (!resposta.ok) throw new ErroRadar(mensagemDeErro(resposta, corpo), resposta.status)
      if (corpo === null) throw new ErroRadar('Resposta inesperada do Radar (não é JSON).', resposta.status)
      return corpo
    },
  }
}

function mensagemDeErro(resposta, corpo) {
  const detalhe = Array.isArray(corpo?.erros) && corpo.erros.length ? ' ' + corpo.erros.map((e) => `${e.campo}: ${e.mensagem}`).join('; ') : ''
  switch (resposta.status) {
    case 401: return 'Chave do Radar ausente, inválida ou revogada.'
    case 403: return 'A chave configurada é de escrita: use uma chave de LEITURA.'
    case 404: return 'Oportunidade não encontrada.'
    case 422: return 'Filtros inválidos.' + detalhe
    case 429: return `Muitas consultas. Tente de novo em ${resposta.headers.get('retry-after') ?? 'alguns'} segundos.`
    case 503: return 'O Radar está sem acesso ao banco de consulta no momento.'
    default: return `O Radar respondeu com erro (HTTP ${resposta.status}).`
  }
}

/** Filtros aceitos por listar_oportunidades (os mesmos da API de leitura). */
export const FILTROS = ['q', 'status', 'torre', 'uf', 'linha_servico', 'segmento', 'analista', 'orgao', 'pregao_de', 'pregao_ate', 'valor_min', 'valor_max', 'atualizado_desde', 'arquivadas']

export async function listarOportunidades(cliente, args = {}) {
  const params = Object.fromEntries(FILTROS.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]))
  params.limite = Math.min(Math.max(Number.isInteger(args.limite) ? args.limite : LIMITE_PADRAO, 1), LIMITE_MAXIMO)
  if (Number.isInteger(args.offset) && args.offset > 0) params.offset = args.offset
  const r = await cliente.get('/oportunidades', params)
  return { total: r.total, retornadas: r.itens.length, offset: r.offset, proximo_offset: r.proximo_offset, itens: r.itens }
}

export async function verOportunidade(cliente, { codigo } = {}) {
  const c = String(codigo ?? '').trim()
  if (!CODIGO_OK.test(c)) throw new ErroRadar('Informe o código no formato AAAA-NNNN (ex.: 2026-0001) ou o id numérico.')
  return cliente.get('/oportunidades/' + encodeURIComponent(c))
}

export const listarCampos = (cliente) => cliente.get('/campos')
