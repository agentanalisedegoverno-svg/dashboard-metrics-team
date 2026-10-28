/**
 * API externa: outra aplicação cria oportunidades no Radar como se fosse um cadastro manual.
 *
 * ATENÇÃO (lembrete): os campos desta API são os MESMOS do formulário (`src/features/oportunidades/campos.ts` e o esquema Zod em
 * `src/domain/oportunidade.ts`). O catálogo servido em `GET /api/externo/campos` é gerado direto de `campos.ts`, mas o documento
 * `docs/API-EXTERNA.md` é escrito à mão: ao criar, renomear ou remover um campo, atualize-o (um teste falha se faltar algum campo lá)
 * e avise as aplicações que usam a API.
 *
 * Autenticação: chave por aplicação (`Authorization: Bearer rdr_...`), guardada no banco só como hash SHA-256. O administrador cria e
 * revoga as chaves em Administração → API. A autoria da oportunidade passa a ser `api:<cliente>` e o `solicitante` (opcional) diz quem
 * pediu na aplicação externa. O resto do fluxo (validação, gatilhos, histórico, e-mail e Planner) é o do cadastro manual.
 */
import { z } from 'zod'
import type { Sql } from './cadastro.ts'
import { dispararEnvioEmails } from './dispararEmails.ts'
import { dispararPlanner } from './dispararPlanner.ts'
import { montarEmail, type DadosEmail } from './emailMsg.ts'
import { bancoApp, erroBanco, send, type Env } from './http.ts'
import { tituloCartao, type OportunidadePlanner } from './planner.ts'
import { notaCompleta } from './plannerNota.ts'

export const PREFIXO_CHAVE = 'rdr_'
/** Corpo máximo aceito (um cadastro real tem poucos KB). */
export const LIMITE_CORPO = 64 * 1024

const NOME_CLIENTE = /^[a-z0-9][a-z0-9_-]{2,39}$/

/** Gera uma chave nova (256 bits aleatórios). Só é mostrada uma vez, na criação. */
export function gerarChave(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return PREFIXO_CHAVE + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashChave(chave: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Lê a chave de `Authorization: Bearer ...` (ou, alternativa, `x-api-key`). Formato inválido vira null sem tocar no banco. */
export function chaveDaRequisicao(request: Request): string | null {
  const auth = request.headers.get('authorization')
  const bruta = auth?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? request.headers.get('x-api-key')?.trim() ?? null
  return bruta && /^rdr_[A-Za-z0-9_-]{20,80}$/.test(bruta) ? bruta : null
}

/** Devolve o nome do cliente dono da chave, ou null (chave ausente, inválida ou revogada). */
export async function autenticar(sql: Sql, request: Request): Promise<string | null> {
  const chave = chaveDaRequisicao(request)
  if (!chave) return null
  const [r] = await sql`select autenticar_api_cliente(${await hashChave(chave)}) as nome`
  return (r?.nome as string | null) ?? null
}

// O catálogo de campos e o OpenAPI moram em src/domain/catalogoApi.ts (a tela de documentação também os usa).
export { catalogoCampos, openApi, REGRAS, type CampoApi } from '../../src/domain/catalogoApi.ts'

// ---------------------------------------------------------------- rota com chave de API

type ArgsExterno = { sql: Sql; cliente: string; request: Request; env: Env; corpo: () => Promise<unknown> }
type Ctx = { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }

/**
 * Esqueleto das rotas da API externa: chave obrigatória (sem Access/CSRF: é chamada servidor a servidor), corpo limitado e
 * resposta sem cache. Depois de criar (201), aciona e-mail e Planner na hora, como o cadastro manual.
 */
export const rotaExterna =
  (metodos: Record<string, (a: ArgsExterno) => Promise<Response>>) =>
  async ({ request, env, waitUntil }: Ctx): Promise<Response> => {
    const handler = metodos[request.method]
    if (!handler) return send(405, { error: 'Método não permitido.' })
    const sql = bancoApp(env) as Sql | null
    if (!sql) return send(503, { error: 'Banco de dados do cadastro não configurado.' })
    try {
      const cliente = await autenticar(sql, request)
      if (!cliente) {
        const r = send(401, { error: 'Chave de API ausente, inválida ou revogada.' })
        r.headers.set('www-authenticate', 'Bearer realm="radar-prevendas"')
        return r
      }
      const resposta = await handler({
        sql,
        cliente,
        request,
        env,
        corpo: async () => {
          const texto = await request.text()
          if (texto.length > LIMITE_CORPO) return send(413, { error: `Corpo acima de ${LIMITE_CORPO / 1024} KB.` })
          try {
            return JSON.parse(texto) as unknown
          } catch {
            return send(400, { error: 'Corpo da requisição não é um JSON válido.' })
          }
        },
      })
      if (request.method === 'POST' && resposta.status === 201) {
        const disparo = Promise.all([dispararEnvioEmails(env), dispararPlanner(env)])
        if (waitUntil) waitUntil(disparo)
        else void disparo
      }
      return resposta
    } catch (e) {
      console.error('Erro na API externa:', e instanceof Error ? e.message : e)
      return send(502, { error: 'Não foi possível concluir a operação.' })
    }
  }

/** `?simular=true` (ou `1`): só valida e mostra como ficaria; não grava nada, não envia e-mail e não cria cartão. */
export const querSimular = (request: Request) => ['1', 'true'].includes((new URL(request.url).searchParams.get('simular') ?? '').toLowerCase())

const txt = (v: unknown) => (v === null || v === undefined ? null : String(v))

/** Prévia do e-mail e do cartão do Planner que a oportunidade geraria (mesmos textos de produção; nada é enviado). */
export function previa(o: Record<string, unknown>) {
  const email = montarEmail(
    {
      codigo: txt(o.codigo), orgao: txt(o.orgao), descritivo: txt(o.descritivo), objeto: txt(o.objeto), processo: txt(o.processo), uasg: txt(o.uasg), status: txt(o.status),
      torre: txt(o.torre), linha_servico: txt(o.linha_servico), uf: txt(o.uf), data_pregao_dt: txt(o.data_pregao_dt), hora_pregao: txt(o.hora_pregao), analista: txt(o.analista),
      orcamento: typeof o.orcamento === 'number' ? o.orcamento : null, orcamento_sigiloso: o.orcamento_sigiloso === true, criado_por: txt(o.criado_por), dados: o,
    } satisfies DadosEmail,
    'https://radar-prevendas.pages.dev',
  )
  return {
    email: { assunto: email.assunto, texto: email.texto },
    planner: { titulo: tituloCartao(o as unknown as OportunidadePlanner), anotacao: notaCompleta(o, String(o.codigo)) },
  }
}

/** Acrescenta a prévia à resposta de uma simulação bem-sucedida (200); qualquer outra resposta passa como veio. */
export async function comPrevia(resposta: Response): Promise<Response> {
  if (resposta.status !== 200) return resposta
  const corpo = (await resposta.json()) as Record<string, unknown>
  return send(200, { ...corpo, previa: previa(corpo) })
}

/** Separa `solicitante` (metadado da API) dos campos da oportunidade. */
export function separarSolicitante(corpo: unknown): { dados: unknown; solicitante: string | null } | Response {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) return send(400, { error: 'O corpo deve ser um objeto JSON com os campos da oportunidade.' })
  const { solicitante, ...dados } = corpo as Record<string, unknown>
  if (solicitante !== undefined && solicitante !== null && typeof solicitante !== 'string') {
    return send(422, { error: 'Dados inválidos.', erros: [{ campo: 'solicitante', mensagem: 'Deve ser texto' }] })
  }
  const s = typeof solicitante === 'string' ? solicitante.trim() : ''
  if (s.length > 120) return send(422, { error: 'Dados inválidos.', erros: [{ campo: 'solicitante', mensagem: 'Máximo de 120 caracteres' }] })
  return { dados, solicitante: s || null }
}

/** Cabeçalho `Idempotency-Key` (opcional): repetir a chamada com a mesma chave devolve a oportunidade já criada, sem duplicar. */
export function chaveIdempotencia(request: Request): string | null | Response {
  const v = request.headers.get('idempotency-key')
  if (v === null) return null
  const t = v.trim()
  return t.length >= 1 && t.length <= 100 && /^[\x21-\x7e]+$/.test(t) ? t : send(422, { error: 'Dados inválidos.', erros: [{ campo: 'Idempotency-Key', mensagem: 'Use de 1 a 100 caracteres imprimíveis, sem espaços' }] })
}

// ---------------------------------------------------------------- administração das chaves (Cloudflare Access + administrador)

const novoCliente = z.object({ nome: z.string().trim().toLowerCase() })

export async function listarClientes(sql: Sql, email: string) {
  try {
    const [r] = await sql`select listar_api_clientes(${email}) as r`
    return send(200, { clientes: r.r })
  } catch (e) {
    return erroBanco(e)
  }
}

/** Cria o cliente e devolve a chave UMA vez (o banco guarda só o hash). */
export async function criarCliente(sql: Sql, email: string, corpo: unknown) {
  const p = novoCliente.safeParse(corpo)
  if (!p.success || !NOME_CLIENTE.test(p.data.nome)) {
    return send(422, { error: 'Dados inválidos.', erros: [{ campo: 'nome', mensagem: 'Use de 3 a 40 caracteres: letras minúsculas, números, - e _' }] })
  }
  const chave = gerarChave()
  try {
    const [r] = await sql`select criar_api_cliente(${p.data.nome}, ${await hashChave(chave)}, ${email}) as r`
    return send(201, { cliente: r.r, chave })
  } catch (e) {
    return erroBanco(e)
  }
}

export async function revogarCliente(sql: Sql, email: string, id: string) {
  if (!/^\d{1,15}$/.test(id)) return send(404, { error: 'Cliente da API não encontrado.' })
  try {
    const [r] = await sql`select revogar_api_cliente(${id}::bigint, ${email}) as r`
    return send(200, r.r)
  } catch (e) {
    return erroBanco(e)
  }
}
