/**
 * Diagnóstico das rotas /api/*: deixa claro DE ONDE veio um erro (ex.: o 503 de um usuário) e deixa rastro no log.
 *
 * Toda resposta que passa pelo código do Radar sai com:
 *   x-radar-origem: funcao   -> a resposta foi gerada pelo Radar. Se um erro (503, 502...) chegar SEM este cabeçalho, ele veio de fora:
 *                               Cloudflare (Access, limites do Worker), proxy/firewall da rede do usuário ou queda da plataforma.
 *   x-radar-req: <8 hex>     -> código da requisição: o usuário informa e se acha a linha no log (Real-time logs do Cloudflare).
 *   server-timing: app;dur=N -> tempo total na função (mais as etapas que a rota registrar, ex.: db e linhas em /api/rows).
 *
 * Log (uma linha JSON, sem e-mail, sem query string, sem corpo): só para 5xx e 429 (console.error) e para respostas lentas (console.warn).
 * Erros 4xx comuns (401, 403, 404, 422) não entram, para não virar ruído.
 */
export const ORIGEM = 'x-radar-origem'
export const REQ = 'x-radar-req'
/** Resposta acima disso é registrada como lenta. */
export const LENTO_MS = 1500

export const novoId = () => [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, '0')).join('')

/** Uma entrada do cabeçalho Server-Timing: `nome;dur=12;desc="texto"`. */
export const entradaTempo = (nome: string, ms: number, desc?: string) =>
  `${nome};dur=${Math.max(0, Math.round(ms))}${desc ? `;desc="${desc.replace(/[^\w .,/%-]/g, '')}"` : ''}`

type ComCf = Request & { cf?: { colo?: string; country?: string } }

function registrar(nivel: 'error' | 'warn', request: Request, status: number, ms: number, req: string, extra: Record<string, unknown> = {}) {
  const cf = (request as ComCf).cf
  const linha = JSON.stringify({
    evt: 'api',
    req,
    s: status,
    ms,
    m: request.method,
    rota: new URL(request.url).pathname,
    ray: request.headers.get('cf-ray'),
    colo: cf?.colo ?? null,
    pais: cf?.country ?? null,
    ...extra,
  })
  if (nivel === 'error') console.error(linha)
  else console.warn(linha)
}

/**
 * Envolve o atendimento de uma rota (usado pelo functions/api/_middleware.ts): marca a resposta, mede o tempo, registra o que importa
 * e transforma exceção não tratada em um 500 JSON identificável (em vez de uma página de erro do Cloudflare sem pista).
 */
export async function comDiagnostico(request: Request, next: () => Promise<Response>): Promise<Response> {
  const req = novoId()
  const inicio = Date.now()
  let res: Response
  let excecao: string | null = null
  try {
    res = await next()
  } catch (e) {
    excecao = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : 'erro desconhecido'
    res = new Response(JSON.stringify({ error: 'Erro interno ao processar a requisição.', req }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    })
  }
  const ms = Date.now() - inicio
  const headers = new Headers(res.headers)
  headers.set(ORIGEM, 'funcao')
  headers.set(REQ, req)
  const etapas = headers.get('server-timing')
  headers.set('server-timing', [entradaTempo('app', ms), etapas].filter(Boolean).join(', '))

  if (res.status >= 500 || res.status === 429) registrar('error', request, res.status, ms, req, { st: etapas, ...(excecao ? { excecao } : {}) })
  else if (ms >= LENTO_MS) registrar('warn', request, res.status, ms, req, { st: etapas, lento: true })

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// ---------------------------------------------------------------- limite simples por chave (janela fixa, em memória)
const janelas = new Map<string, { inicio: number; n: number }>()
/** true se ainda está dentro do limite (`max` por minuto). Usado pelo /api/diagnostico, que roda consultas de verdade. */
export function dentroDoLimite(chave: string, max: number, agora = Date.now()): boolean {
  let j = janelas.get(chave)
  if (!j || agora - j.inicio >= 60_000) {
    if (janelas.size >= 2000) janelas.clear()
    j = { inicio: agora, n: 0 }
    janelas.set(chave, j)
  }
  return ++j.n <= max
}
export const reiniciarLimiteDiagnostico = () => janelas.clear()
