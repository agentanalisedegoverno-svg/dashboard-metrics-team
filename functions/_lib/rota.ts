/** Esqueleto comum das rotas de cadastro: identidade, CSRF nas escritas e conexão com o papel `radar_app`. */
import { bancoApp, csrfOk, identificar, lerJson, send, type Env } from './http.ts'
import type { Sql } from './cadastro.ts'

type Ctx = { request: Request; env: Env; params: Record<string, string | string[] | undefined> }
type Args = { sql: Sql; email: string; request: Request; params: Ctx['params']; corpo: () => Promise<unknown> }
type Handler = (a: Args) => Promise<Response>

export const rota =
  (metodos: Record<string, Handler>) =>
  async ({ request, env, params }: Ctx): Promise<Response> => {
    const handler = metodos[request.method]
    if (!handler) return send(405, { error: 'Método não permitido.' })
    const id = await identificar(request, env)
    if (id instanceof Response) return id
    if (request.method !== 'GET' && !csrfOk(request)) return send(403, { error: 'Requisição rejeitada (origem não confiável).' })
    const sql = bancoApp(env) as Sql | null
    if (!sql) return send(503, { error: 'Banco de dados do cadastro não configurado.' })
    try {
      return await handler({ sql, email: id.email, request, params, corpo: () => lerJson(request) })
    } catch (e) {
      console.error('Erro na rota:', e instanceof Error ? e.message : e)
      return send(502, { error: 'Não foi possível concluir a operação.' })
    }
  }

/** Se o corpo não for JSON, `lerJson` devolve uma Response: repassa-a em vez de validar. */
export const comCorpo = async (corpo: () => Promise<unknown>, usar: (j: unknown) => Promise<Response>) => {
  const j = await corpo()
  return j instanceof Response ? j : usar(j)
}
