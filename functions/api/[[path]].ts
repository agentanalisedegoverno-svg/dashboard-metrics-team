import { verifyAccessJwt } from '../_lib/access'
import { fetchSheetValues, missingGraphConfig, type GraphEnv } from '../_lib/graph'
import { mapRows } from '../_lib/rows'

type Env = GraphEnv & { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string }
type Ctx = { request: Request; env: Env; params: { path?: string | string[] } }

const CACHE_TTL_S = 300
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })

type Snapshot = { rows: unknown[]; lastSyncAt: string }
const cacheKey = (req: Request) => new Request(new URL('/__rows_snapshot', req.url).toString())

async function load(req: Request, env: Env, force: boolean): Promise<Snapshot> {
  const cache = (caches as unknown as { default: Cache }).default
  const key = cacheKey(req)
  if (!force) {
    const hit = await cache.match(key)
    if (hit) return (await hit.json()) as Snapshot
  }
  const rows = mapRows(await fetchSheetValues(env))
  const snap: Snapshot = { rows, lastSyncAt: new Date().toISOString() }
  await cache.put(key, new Response(JSON.stringify(snap), { headers: { 'cache-control': `max-age=${CACHE_TTL_S}` } }))
  return snap
}

export const onRequest = async ({ request, env, params }: Ctx): Promise<Response> => {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    return send(503, { error: 'Autenticação (Cloudflare Access) não configurada.' })
  }
  const authorized = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    audience: env.CF_ACCESS_AUD,
  })
  if (!authorized) return send(401, { error: 'Não autorizado.' })

  const missing = missingGraphConfig(env)
  if (missing.length) return send(503, { error: `Integração SharePoint não configurada (${missing.join(', ')}).` })

  const route = [params.path].flat().join('/')
  try {
    if (request.method === 'GET' && route === 'rows') {
      const s = await load(request, env, false)
      return send(200, { rows: s.rows, updatedAt: s.lastSyncAt, isMock: false })
    }
    if (request.method === 'GET' && route === 'status') {
      const s = await load(request, env, false)
      return send(200, { lastSyncAt: s.lastSyncAt, rowCount: s.rows.length, error: null, isMock: false })
    }
    if (request.method === 'POST' && route === 'sync') {
      const s = await load(request, env, true)
      return send(200, { lastSyncAt: s.lastSyncAt, rowCount: s.rows.length, error: null, isMock: false })
    }
    return send(404, { error: 'Rota não encontrada.' })
  } catch (error) {
    console.error('Erro na API de leitura:', error)
    return send(502, { error: 'Não foi possível ler a fonte de dados.' })
  }
}
