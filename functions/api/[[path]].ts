import { fetchSheet, GraphError, missingGraphConfig, type GraphEnv } from '../_lib/graph'
import { mapRows } from '../_lib/rows'

type Ctx = { request: Request; env: GraphEnv; params: { path?: string | string[] } }

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }
const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })

/**
 * API de leitura. Exige o token Microsoft do usuário (Authorization: Bearer) e o repassa ao Graph;
 * nada é guardado em cache compartilhado, para que o acesso nunca seja concedido a quem o
 * SharePoint não autorizaria. `sync` apenas relê a fonte (não há estado no servidor).
 */
export const onRequest = async ({ request, env, params }: Ctx): Promise<Response> => {
  const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return send(401, { error: 'Não autorizado.' })

  const missing = missingGraphConfig(env)
  if (missing.length) return send(503, { error: `Integração SharePoint não configurada (${missing.join(', ')}).` })

  const route = [params.path].flat().join('/')
  const isRead = request.method === 'GET' && (route === 'rows' || route === 'status')
  if (!isRead && !(request.method === 'POST' && route === 'sync')) return send(404, { error: 'Rota não encontrada.' })

  try {
    const sheet = await fetchSheet(env, token)
    const rows = mapRows(sheet.values)
    const lastSyncAt = sheet.lastModified ?? new Date().toISOString()
    if (route === 'rows') return send(200, { rows, updatedAt: lastSyncAt, isMock: false })
    return send(200, { lastSyncAt, rowCount: rows.length, error: null, isMock: false })
  } catch (error) {
    if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
      return send(error.status, { error: 'Sem permissão para ler a planilha.' })
    }
    console.error('Erro na API de leitura:', error instanceof Error ? error.message : error)
    return send(502, { error: 'Não foi possível ler a fonte de dados.' })
  }
}
