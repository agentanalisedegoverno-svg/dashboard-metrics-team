/**
 * Cache de curta duração das respostas de leitura do painel (/api/rows e /api/status), no Cache API do Cloudflare.
 *
 * POR QUE: no plano gratuito cada requisição tem ~10 ms de CPU, e cada /api/rows abre uma conexão com o Postgres (TLS + autenticação),
 * consulta e repassa ~500 KB. No pico (vários usuários abrindo o painel juntos) isso estoura o teto ("Exceeded CPU Time Limits", que
 * chega como 503). A resposta é a MESMA para todos os usuários autorizados (não há filtro por usuário), então uma cópia guardada por
 * alguns segundos serve todo mundo sem abrir conexão nem consultar o banco: quem acerta o cache só repassa o corpo.
 *
 * SEGURANÇA: o cache só é consultado DEPOIS da validação do Access (ver [[path]].ts); sem JWT válido nada chega aqui. O que vai ao
 * navegador continua `private, no-store`; o `public, max-age` fica só na cópia interna, com chave que o usuário não controla.
 *
 * FRESCOR: o TTL é curto (rows e status 60 s). Quem acabou de gravar, ou clicou em atualizar, pede `?fresco=1`: a leitura vai ao
 * banco e SUBSTITUI a cópia, então os demais também passam a ver o dado novo. O cache é por ponto de presença (não global).
 *
 * FALHA SEGURA: sem Cache API (testes, ambiente sem suporte) ou se ela falhar, a resposta vem do banco como antes.
 * O cabeçalho `x-radar-cache` diz o que aconteceu: hit | miss | fresco | off.
 */
import { entradaTempo } from './diagnostico.ts'

export const TTL_ROWS_S = 60
export const TTL_STATUS_S = 60

type CacheLike = { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> }

const cacheDoWorker = (): CacheLike | null => {
  try {
    return (globalThis as { caches?: { default?: CacheLike } }).caches?.default ?? null
  } catch {
    return null
  }
}

const chave = (rota: string) => new Request(`https://cache.radar.internal/api/${rota}`)

type Opcoes = {
  rota: 'rows' | 'status'
  ttl: number
  /** Ignora a cópia guardada, lê do banco e a substitui. */
  fresco: boolean
  /** Cabeçalhos da resposta ao navegador (private, no-store etc.). */
  cabecalhos: Record<string, string>
  /** Lê do banco. Só é chamada quando não há cópia válida (é aqui que a conexão é aberta). */
  gerar: () => Promise<{ corpo: string; tempo: string }>
  waitUntil?: (p: Promise<unknown>) => void
}

export async function respostaComCache({ rota, ttl, fresco, cabecalhos, gerar, waitUntil }: Opcoes): Promise<Response> {
  const cache = cacheDoWorker()
  const k = chave(rota)

  if (cache && !fresco) {
    try {
      const guardada = await cache.match(k)
      if (guardada) {
        const idade = Math.max(0, Math.round((Date.now() - Number(guardada.headers.get('x-radar-gerado'))) / 1000))
        return new Response(guardada.body, {
          status: 200,
          headers: { ...cabecalhos, 'server-timing': entradaTempo('cache', 0, `copia de ${Number.isFinite(idade) ? idade : 0} s`), 'x-radar-cache': 'hit' },
        })
      }
    } catch {
      // falha do cache nunca derruba a leitura: segue para o banco
    }
  }

  const { corpo, tempo } = await gerar()
  let estado = 'off'
  if (cache) {
    estado = fresco ? 'fresco' : 'miss'
    const guardar = cache
      .put(k, new Response(corpo, { headers: { 'content-type': cabecalhos['content-type'] ?? 'application/json', 'cache-control': `public, max-age=${ttl}`, 'x-radar-gerado': String(Date.now()) } }))
      .catch(() => {})
    if (waitUntil) waitUntil(guardar)
    else await guardar
  }
  return new Response(corpo, { status: 200, headers: { ...cabecalhos, 'server-timing': tempo, 'x-radar-cache': estado } })
}
