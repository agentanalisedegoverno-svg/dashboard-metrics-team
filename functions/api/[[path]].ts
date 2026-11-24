import { conectar } from '../_lib/banco'
import { verifyAccessJwt } from '../_lib/access'
import { entradaTempo } from '../_lib/diagnostico.ts'
import { consultarPainel, consultarStatus, corpoDoPainel } from '../_lib/painel.ts'

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
    // A etapa é medida e vai no cabeçalho Server-Timing (ver docs/DIAGNOSTICO.md): mostra o tempo da consulta e o tamanho da resposta.
    const t = Date.now()
    if (route === 'rows') {
      // Uma única consulta; o Postgres devolve as linhas já em JSON e o Worker só repassa o texto (poupa CPU: ver painel.ts).
      const painel = await consultarPainel(sql)
      const corpo = corpoDoPainel(painel)
      const etapa = entradaTempo('consulta', Date.now() - t, `${painel.total} linhas, ${Math.round(corpo.length / 1024)} KB`)
      return new Response(corpo, { status: 200, headers: { ...headers, 'server-timing': etapa } })
    }
    const status = await consultarStatus(sql)
    const lastSyncAt = status?.ultima_carga_em ? new Date(status.ultima_carga_em).toISOString() : null
    return new Response(JSON.stringify({ lastSyncAt, rowCount: status?.total_linhas ?? 0, error: status?.erro ?? null, isMock: false }), {
      status: 200,
      headers: { ...headers, 'server-timing': entradaTempo('status', Date.now() - t) },
    })
  } catch (error) {
    console.error('Erro na API de leitura:', error instanceof Error ? error.message : error)
    return send(502, { error: 'Não foi possível ler o banco de dados.' })
  }
}
