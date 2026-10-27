/**
 * Infraestrutura comum das rotas de cadastro: identidade (Cloudflare Access), proteção CSRF,
 * mapeamento dos erros do Postgres (SQLSTATE próprios) para respostas HTTP.
 */
import { neon } from '@neondatabase/serverless'
import { verifyAccessIdentity } from './access'

export type Env = {
  DATABASE_URL?: string
  DATABASE_URL_APP?: string
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  ACESSO_PUBLICO?: string
  /** Token do GitHub (permissão só de Actions) que aciona o envio de e-mails ao cadastrar. Opcional. */
  GITHUB_DISPATCH_TOKEN?: string
  GITHUB_REPO?: string
}

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }
export const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })

/** Cabeçalho que o front envia em toda escrita; um formulário de outro site não consegue enviá-lo. */
export const CSRF_HEADER = 'x-radar-csrf'

/** Garante que a escrita veio do próprio site (cabeçalho customizado + Origin igual ao host). */
export function csrfOk(request: Request): boolean {
  if (request.headers.get(CSRF_HEADER) !== '1') return false
  const origin = request.headers.get('origin')
  return origin === null || new URL(origin).host === new URL(request.url).host
}

export type Identidade = { email: string }

/** Devolve o e-mail autenticado, ou a resposta de erro adequada. */
export async function identificar(request: Request, env: Env): Promise<Identidade | Response> {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return send(503, { error: 'Autenticação (Cloudflare Access) não configurada.' })
  const id = await verifyAccessIdentity(request.headers.get('cf-access-jwt-assertion'), {
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    audience: env.CF_ACCESS_AUD,
  })
  if (!id) return send(401, { error: 'Não autorizado.' })
  if (!id.email) return send(403, { error: 'A sessão não traz um e-mail; não é possível registrar o autor.' })
  return { email: id.email }
}

export const bancoApp = (env: Env) => (env.DATABASE_URL_APP ? neon(env.DATABASE_URL_APP) : null)

type ErroPg = { code?: string; message?: string }

/** Traduz os erros levantados pelas funções do banco (P0403/P0404/P0409/P0422). */
export function erroBanco(e: unknown): Response {
  const err = (e ?? {}) as ErroPg
  const parse = () => {
    try {
      return JSON.parse(err.message ?? 'null')
    } catch {
      return null
    }
  }
  switch (err.code) {
    case 'P0422':
      return send(422, { error: 'Dados inválidos.', erros: parse() ?? [{ campo: 'corpo', mensagem: err.message }] })
    case 'P0409':
      return send(409, { error: 'Outra pessoa alterou este registro. Recarregue para ver a versão atual.', ...(parse() ?? {}) })
    case 'P0403':
      return send(403, { error: err.message ?? 'Sem permissão.' })
    case 'P0404':
      return send(404, { error: err.message ?? 'Não encontrado.' })
    case '23505':
      return send(422, { error: 'Dados inválidos.', erros: [{ campo: 'email', mensagem: 'Já existe um usuário com este e-mail ou nome.' }] })
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
    case '22P05': // \u0000 e outras sequências Unicode que o jsonb não aceita
    case '22021': // bytes inválidos para UTF-8
      return send(422, { error: 'Dados inválidos.', erros: [{ campo: 'corpo', mensagem: 'Valor em formato inválido.' }] })
    default:
      console.error('Erro no cadastro:', err.code, err.message)
      return send(502, { error: 'Não foi possível concluir a operação no banco de dados.' })
  }
}

export async function lerJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json()
  } catch {
    return send(400, { error: 'Corpo da requisição não é um JSON válido.' })
  }
}
