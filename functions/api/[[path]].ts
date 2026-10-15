import { neon } from '@neondatabase/serverless'
import { verifyAccessJwt } from '../_lib/access'

type Env = { DATABASE_URL?: string; CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; ACESSO_PUBLICO?: string }
type Ctx = { request: Request; env: Env; params: { path?: string | string[] } }

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }
const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })

/**
 * API de leitura do painel. Os dados vêm do Postgres (Neon), alimentado por um agente externo
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
    const sql = neon(env.DATABASE_URL)
    const [status] = (await sql`
      select ultima_carga_em, total_linhas, erro from carga_status where id = 1`) as {
      ultima_carga_em: string | null
      total_linhas: number
      erro: string | null
    }[]
    const lastSyncAt = status?.ultima_carga_em ? new Date(status.ultima_carga_em).toISOString() : null

    if (route === 'rows') {
      const rows = await sql`
        select ano, mes, status, uf, torre, linha_servico as "linhaServico", vistoria, analista,
               motivo_no_go as "motivoNoGo", motivo_lost as "motivoLost", conta_vinculada as "contaVinculada",
               orcamento::float8 as orcamento, valor_ctc::float8 as "valorCtc", valor_vencedor::float8 as "valorVencedor",
               sla::float8 as sla, processo, orgao, descritivo, data_pregao as "dataPregao", acao_ia as "acaoIA"
        from oportunidades where arquivado_em is null order by id`
      return send(200, { rows, updatedAt: lastSyncAt, isMock: false })
    }
    return send(200, { lastSyncAt, rowCount: status?.total_linhas ?? 0, error: status?.erro ?? null, isMock: false })
  } catch (error) {
    console.error('Erro na API de leitura:', error instanceof Error ? error.message : error)
    return send(502, { error: 'Não foi possível ler o banco de dados.' })
  }
}
