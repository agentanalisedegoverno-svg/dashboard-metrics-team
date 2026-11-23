/**
 * Servidor MCP REMOTO (somente leitura) do Radar Pré-Vendas: transporte "Streamable HTTP" sem sessão, em JSON puro.
 *
 * É a versão hospedada do servidor de `mcp/`: em vez de cada pessoa instalar Node e a pasta `mcp/`, o agente (Claude.ai, Copilot
 * Studio, Gemini CLI, Cursor...) aponta para `https://<site>/api/externo/mcp` com a chave de LEITURA no cabeçalho Authorization.
 *
 * Segurança: a rota (`functions/api/externo/mcp.ts`) herda a autenticação por chave, o limite de requisições e o escopo `leitura` de
 * `rotaExterna`; as consultas passam pela conexão `radar_leitor` (só SELECT) e reutilizam a MESMA validação rígida da API de leitura
 * (`leituraOportunidades.ts`). Aqui não existe ferramenta de escrita, e nenhuma entrada vira SQL: tudo é parâmetro vinculado.
 */
import type { Sql } from './cadastro.ts'
import { catalogoCampos, REGRAS } from './apiExterna.ts'
import { send } from './http.ts'
import { LIMITE_MAXIMO as LIMITE_API, listarParaLeitura, obterParaLeitura } from './leituraOportunidades.ts'

/** Versões do protocolo aceitas (a mais nova primeiro). O servidor responde com a do cliente, se a conhece; senão, com a mais nova. */
export const VERSOES = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
/** Tamanho de página das ferramentas: menor que o da API para não estourar o contexto do agente. */
export const LIMITE_PADRAO = 25
export const LIMITE_MAXIMO = 100

type Id = string | number | null
type Rpc = { jsonrpc: '2.0'; id: Id; result?: unknown; error?: { code: number; message: string } }
type Conteudo = { content: { type: 'text'; text: string }[]; isError?: boolean }

const SOMENTE_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const str = (descricao: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description: descricao, ...extra })
const DATA = { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }

export const FERRAMENTAS = [
  {
    name: 'listar_oportunidades',
    title: 'Listar oportunidades',
    description:
      'Lista oportunidades do Radar Pré-Vendas (todos os campos de cada uma), com filtros e paginação. Somente leitura. ' +
      `Retorna no máximo ${LIMITE_MAXIMO} por chamada (padrão ${LIMITE_PADRAO}); use proximo_offset para a página seguinte. ` +
      'Sem filtros devolve as ativas (arquivadas ficam de fora). Use listar_campos para ver os valores válidos de status, torre, etc.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: str('Busca de texto em código, sigla, órgão, processo, descritivo, objeto, UASG, pré-vendas e linha de serviço', { maxLength: 100 }),
        status: str('Ex.: Go, Win, Prospect (sem diferenciar maiúsculas)', { maxLength: 60 }),
        torre: str('Torre', { maxLength: 60 }),
        uf: str('Sigla do estado, ex.: DF', { minLength: 2, maxLength: 2 }),
        linha_servico: str('Linha de serviço', { maxLength: 100 }),
        segmento: { type: 'string', enum: ['Corporate', 'Público'] },
        analista: str('Pré-vendas responsável (contém o nome)', { maxLength: 100 }),
        orgao: str('Órgão (contém o texto)', { maxLength: 100 }),
        pregao_de: str('Data do pregão a partir de (AAAA-MM-DD)', DATA),
        pregao_ate: str('Data do pregão até (AAAA-MM-DD)', DATA),
        valor_min: { type: 'number', minimum: 0, description: 'Orçamento mínimo em reais; sem valor ou sigiloso não entra quando há faixa' },
        valor_max: { type: 'number', minimum: 0, description: 'Orçamento máximo em reais' },
        atualizado_desde: str('Só o que mudou desde essa data/hora ISO', { maxLength: 40 }),
        arquivadas: { type: 'boolean', description: 'true para incluir as arquivadas' },
        limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
        offset: { type: 'integer', minimum: 0 },
      },
    },
    annotations: SOMENTE_LEITURA,
  },
  {
    name: 'ver_oportunidade',
    title: 'Ver uma oportunidade',
    description: 'Mostra uma oportunidade com todos os campos, pelo código (AAAA-NNNN, ex.: 2026-0001) ou pelo id numérico. Somente leitura.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['codigo'], properties: { codigo: str('Código AAAA-NNNN ou id numérico', { minLength: 1, maxLength: 20 }) } },
    annotations: SOMENTE_LEITURA,
  },
  {
    name: 'listar_campos',
    title: 'Listar campos e valores válidos',
    description: 'Catálogo dos campos das oportunidades e as listas de valores válidos (status, torre, UF, linha de serviço etc.). Somente leitura.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: SOMENTE_LEITURA,
  },
]

const texto = (dados: unknown): Conteudo => ({ content: [{ type: 'text', text: JSON.stringify(dados, null, 2) }] })
const falha = (mensagem: string): Conteudo => ({ isError: true, content: [{ type: 'text', text: mensagem }] })

/** Traduz uma resposta de erro da API de leitura numa mensagem curta e clara (nunca repassa texto cru do servidor). */
async function mensagemDeErro(r: Response): Promise<Conteudo> {
  if (r.status === 404) return falha('Oportunidade não encontrada.')
  if (r.status === 422) {
    const j = (await r.json().catch(() => null)) as { erros?: { campo?: string; mensagem?: string }[] } | null
    const itens = (j?.erros ?? []).slice(0, 10).map((e) => `${String(e.campo ?? '?').slice(0, 40)}: ${String(e.mensagem ?? '').slice(0, 120)}`)
    return falha(`Filtros inválidos — ${itens.join('; ') || 'revise os parâmetros.'}`)
  }
  return falha('Não foi possível consultar o Radar agora.')
}

/** Monta a query string da API de leitura a partir dos argumentos da ferramenta (valores vazios são descartados). */
export function argumentosParaUrl(args: Record<string, unknown>): URL {
  const url = new URL('https://radar.interno/api/externo/oportunidades')
  const pedido = args.limite
  const limite = typeof pedido === 'number' && Number.isInteger(pedido) ? Math.min(Math.max(pedido, 1), LIMITE_MAXIMO) : LIMITE_PADRAO
  for (const [k, v] of Object.entries(args)) {
    if (k === 'limite' || v === undefined || v === null || v === '') continue
    url.searchParams.set(k, String(v)) // chave desconhecida segue adiante de propósito: a validação estrita da API a recusa (422)
  }
  url.searchParams.set('limite', String(Math.min(limite, LIMITE_API)))
  return url
}

async function executar(nome: string, args: Record<string, unknown>, leitor: Sql): Promise<Conteudo | null> {
  if (nome === 'listar_oportunidades') {
    const invalido = Object.entries(args).find(([, v]) => v !== null && v !== undefined && !['string', 'number', 'boolean'].includes(typeof v))
    if (invalido) return falha(`Filtros inválidos — ${invalido[0].slice(0, 40)}: use texto, número ou verdadeiro/falso.`)
    const r = await listarParaLeitura(leitor, argumentosParaUrl(args))
    if (r.status !== 200) return mensagemDeErro(r)
    const j = (await r.json()) as { total: number; offset: number; proximo_offset: number | null; itens: unknown[] }
    return texto({ total: j.total, retornadas: j.itens.length, offset: j.offset, proximo_offset: j.proximo_offset, itens: j.itens })
  }
  if (nome === 'ver_oportunidade') {
    const codigo = typeof args.codigo === 'string' ? args.codigo.trim() : ''
    if (!/^(\d{4}-\d{1,8}|\d{1,15})$/.test(codigo)) return falha('Informe o código no formato AAAA-NNNN (ex.: 2026-0001) ou o id numérico.')
    const r = await obterParaLeitura(leitor, codigo)
    return r.status === 200 ? texto(await r.json()) : mensagemDeErro(r)
  }
  if (nome === 'listar_campos') {
    const linhas = (await leitor`select lista, valor, ativo from opcoes order by lista, ordem, valor`) as { lista: string; valor: string; ativo: boolean }[]
    const listas: Record<string, { valor: string; ativo: boolean }[]> = {}
    for (const o of linhas) (listas[o.lista] ??= []).push({ valor: o.valor, ativo: o.ativo })
    return texto({ campos: catalogoCampos(listas), regras: REGRAS })
  }
  return null
}

const ok = (id: Id, result: unknown): Rpc => ({ jsonrpc: '2.0', id, result })
const erro = (id: Id, code: number, message: string): Rpc => ({ jsonrpc: '2.0', id, error: { code, message } })

/** Trata UMA mensagem JSON-RPC. Notificações e respostas do cliente não geram retorno (null). */
export async function tratarMensagem(msg: unknown, leitor: Sql): Promise<Rpc | null> {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return erro(null, -32600, 'Requisição inválida.')
  const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
  const id: Id = typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null
  if (typeof m.method !== 'string') return 'result' in m || 'error' in m ? null : erro(id, -32600, 'Requisição inválida.')
  if (m.jsonrpc !== '2.0') return erro(id, -32600, 'Requisição inválida.')
  if (m.id === undefined) return null // notificação (ex.: notifications/initialized)
  const params = m.params !== null && typeof m.params === 'object' && !Array.isArray(m.params) ? (m.params as Record<string, unknown>) : {}

  switch (m.method) {
    case 'initialize': {
      const pedida = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return ok(id, {
        protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'radar-prevendas', title: 'Radar Pré-Vendas (somente leitura)', version: '1.0.0' },
        instructions: 'Consulta somente leitura das oportunidades do Radar Pré-Vendas. Comece por listar_campos para conhecer os valores válidos dos filtros.',
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: FERRAMENTAS })
    case 'tools/call': {
      const nome = typeof params.name === 'string' ? params.name : ''
      if (!FERRAMENTAS.some((f) => f.name === nome)) return erro(id, -32602, 'Ferramenta desconhecida.')
      const args = params.arguments !== null && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {}
      try {
        return ok(id, await executar(nome, args, leitor))
      } catch (e) {
        console.error('Erro no MCP remoto:', e instanceof Error ? e.message : e)
        return ok(id, falha('Não foi possível consultar o Radar agora.'))
      }
    }
    default:
      return erro(id, -32601, 'Método não suportado.')
  }
}

/** Corpo já lido da requisição -> resposta HTTP (200 com JSON-RPC, ou 202 sem corpo quando só havia notificações). */
export async function tratarMcp(corpo: unknown, leitor: Sql): Promise<Response> {
  const lote = Array.isArray(corpo)
  if (lote && (corpo.length === 0 || corpo.length > 20)) return send(200, erro(null, -32600, 'Lote inválido.'))
  const respostas = (await Promise.all((lote ? corpo : [corpo]).map((m: unknown) => tratarMensagem(m, leitor)))).filter((r): r is Rpc => r !== null)
  if (respostas.length === 0) return new Response(null, { status: 202, headers: { 'cache-control': 'private, no-store' } })
  return send(200, lote ? respostas : respostas[0])
}
