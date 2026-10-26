/** Esqueleto comum das rotas de cadastro: identidade, CSRF nas escritas e conexão com o papel `radar_app`. */
import { bancoApp, csrfOk, identificar, lerJson, send, type Env } from './http.ts'
import type { Sql } from './cadastro.ts'
import { dispararEnvioEmails } from './dispararEmails.ts'

type Ctx = { request: Request; env: Env; params: Record<string, string | string[] | undefined>; waitUntil?: (p: Promise<unknown>) => void }
type Args = { sql: Sql; email: string; request: Request; params: Ctx['params']; corpo: () => Promise<unknown> }
type Handler = (a: Args) => Promise<Response>

export const rota =
  (metodos: Record<string, Handler>, opcoes: { semBanco?: boolean; aoCriar?: 'enviarEmails' } = {}) =>
  async ({ request, env, params, waitUntil }: Ctx): Promise<Response> => {
    const handler = metodos[request.method]
    if (!handler) return send(405, { error: 'Método não permitido.' })
    const id = await identificar(request, env)
    if (id instanceof Response) return id
    if (request.method !== 'GET' && !csrfOk(request)) return send(403, { error: 'Requisição rejeitada (origem não confiável).' })
    const sql = (opcoes.semBanco ? ((() => Promise.reject(new Error('rota sem banco'))) as unknown as Sql) : (bancoApp(env) as Sql | null))
    if (!sql) return send(503, { error: 'Banco de dados do cadastro não configurado.' })
    try {
      const resposta = await handler({ sql, email: id.email, request, params, corpo: () => lerJson(request) })
      // Cadastro feito (201): acorda o envio de e-mails na hora, em segundo plano (não atrasa nem derruba a resposta).
      if (opcoes.aoCriar === 'enviarEmails' && request.method === 'POST' && resposta.status === 201) {
        const disparo = dispararEnvioEmails(env)
        if (waitUntil) waitUntil(disparo)
        else void disparo
      }
      return resposta
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
