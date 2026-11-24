import { conectar } from '../_lib/banco'
import { verifyAccessJwt } from '../_lib/access'
import { entradaTempo } from '../_lib/diagnostico.ts'
import { consultarLinhas, consultarStatus } from '../_lib/painel.ts'

type Env = { DATABASE_URL?: string; CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; ACESSO_PUBLICO?: string }
type Ctx = { request: Request; env: Env; params: { path?: string | string[] } }

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }
const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })

/**
 * API de leitura do painel. Os dados vêm do Postgres (Azure), alimentado por um agente externo
 * que substitui a base a cada carga. A conexão usa um papel somente-leitura (`radar_leitor`).
 * Falha fechada: sem Cloudflare Access configurado e um JWT válido, nada é devolvido.
 */
export const onRequest = async ({ request, env, params }: Ctx): Promise<Response> => {
    if (env.ACESSO_PUBLICO !== 'true') {
    if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
      return send(503, { error: 'Autenticação (Cloudflare Access) não configurada.' })
    }
    const authorized = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      audience: env.CF_ACCESS_AUD,
    })
    if (!authorized) return send(401, { error: 'Não autorizado.' })
  }
  if (!env.DATABASE_URL) return send(503, { error: 'Banco de dados não configurado.' })

  const route = [params.path].flat().join('/')
  const isRead = request.method === 'GET' && (route === 'rows' || route === 'status')
  // `sync` não tem mais o que fazer (a carga é feita pelo agente); responde como `status` para o botão do painel.
  if (!isRead && !(request.method === 'POST' && route === 'sync')) return send(404, { error: 'Rota não encontrada.' })

  try {
    const sql = conectar(env.DATABASE_URL)
    // Cada etapa é medida e vai no cabeçalho Server-Timing (ver docs/DIAGNOSTICO.md): mostra se a lentidão está no banco,
    // na carga das linhas ou no tamanho da resposta.
    const etapas: string[] = []
    let t = Date.now()
    const status = await consultarStatus(sql)
    etapas.push(entradaTempo('status', Date.now() - t))
    const lastSyncAt = status?.ultima_carga_em ? new Date(status.ultima_carga_em).toISOString() : null

    if (route === 'rows') {
      t = Date.now()
      const rows = await consultarLinhas(sql)
      etapas.push(entradaTempo('linhas', Date.now() - t, `${rows.length} linhas`))
      t = Date.now()
      const corpo = JSON.stringify({ rows, updatedAt: lastSyncAt, isMock: false }) // uma única serialização
      etapas.push(entradaTempo('json', Date.now() - t, `${Math.round(corpo.length / 1024)} KB`))
      return new Response(corpo, { status: 200, headers: { ...headers, 'server-timing': etapas.join(', ') } })
    }
    return new Response(JSON.stringify({ lastSyncAt, rowCount: status?.total_linhas ?? 0, error: status?.erro ?? null, isMock: false }), {
      status: 200,
      headers: { ...headers, 'server-timing': etapas.join(', ') },
    })
  } catch (error) {
    console.error('Erro na API de leitura:', error instanceof Error ? error.message : error)
    return send(502, { error: 'Não foi possível ler o banco de dados.' })
  }
}
