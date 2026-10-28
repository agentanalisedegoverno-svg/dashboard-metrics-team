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
import { CAMPO_LISTA } from '../../src/domain/oportunidade.ts'
import { SECOES, type Campo } from '../../src/features/oportunidades/campos.ts'
import type { Sql } from './cadastro.ts'
import { dispararEnvioEmails } from './dispararEmails.ts'
import { dispararPlanner } from './dispararPlanner.ts'
import { bancoApp, erroBanco, send, type Env } from './http.ts'

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

// ---------------------------------------------------------------- catálogo de campos (gerado de campos.ts)

const FORMATO: Record<Campo['tipo'], string> = {
  texto: 'texto',
  longo: 'texto (pode ter várias linhas)',
  data: 'data no formato AAAA-MM-DD',
  hora: 'hora HH:MM (horário de Brasília)',
  dinheiro: 'número em reais, com ponto decimal (ex.: 1234.56)',
  percentual: 'fração (0.185 = 18,5%)',
  inteiro: 'número inteiro',
  lista: 'texto: um dos valores da lista indicada',
  preVendas: 'texto: nome(s) de pré-vendas ativos, separados por vírgula',
  bool: 'true ou false',
  cnpj: '14 dígitos (com ou sem máscara); razão social e matriz/filial vêm da Receita',
}

export type CampoApi = {
  nome: string
  rotulo: string
  secao: string
  tipo: Campo['tipo']
  formato: string
  obrigatorio: boolean
  /** Obrigatório a menos que outro campo esteja informado (a torre é calculada pela linha de serviço). */
  obrigatorio_se_ausente?: string
  /** Campo que só faz sentido para estes status (o formulário só o mostra neles). */
  quando_status?: readonly string[]
  /** Obrigatório quando o status for um destes (regra do banco). */
  obrigatorio_se_status?: readonly string[]
  lista?: string
  valores?: string[]
  dica?: string
}

/** Campos que o banco exige conforme o status (mesmas regras do cadastro manual). */
const EXIGIDO_POR_STATUS: Record<string, readonly string[]> = { motivo_no_go: ['No Go'], motivo_lost: ['Lost'], valor_ctc: ['Win'] }

/** Catálogo dos campos aceitos, na ordem do formulário. `listas` traz as opções ativas (por nome de lista) para os campos do tipo lista. */
export function catalogoCampos(listas: Record<string, { valor: string; ativo: boolean }[]> = {}): CampoApi[] {
  return SECOES.flatMap((s) =>
    s.campos.map((c): CampoApi => {
      const lista = c.tipo === 'lista' ? (CAMPO_LISTA as Record<string, string>)[c.nome] : undefined
      return {
        nome: c.nome,
        rotulo: c.rotulo,
        secao: s.titulo,
        tipo: c.tipo,
        formato: FORMATO[c.tipo],
        obrigatorio: Boolean(c.obrigatorio) && !c.calculado,
        ...(c.calculado && c.obrigatorio ? { obrigatorio_se_ausente: 'linha_servico' } : {}),
        ...(c.quando ? { quando_status: c.quando } : {}),
        ...(EXIGIDO_POR_STATUS[c.nome] ? { obrigatorio_se_status: EXIGIDO_POR_STATUS[c.nome] } : {}),
        ...(lista ? { lista, valores: (listas[lista] ?? []).filter((o) => o.ativo).map((o) => o.valor) } : {}),
        ...(c.dica ? { dica: c.dica } : {}),
      }
    }),
  )
}

/** Regras que valem além do formato (as mesmas do cadastro manual; o banco é quem as impõe). */
export const REGRAS = [
  'status, orgao, descritivo e data_pregao_dt são obrigatórios; a torre é calculada pela linha_servico (informe torre só se não enviar linha_servico).',
  'Se status for "No Go", informe motivo_no_go; se for "Lost", motivo_lost; se for "Win", valor_ctc.',
  'data_pregao_dt não pode ser anterior a data_distribuicao.',
  'Campos de lista só aceitam valores cadastrados e ativos (veja "valores" em GET /api/externo/campos).',
  'analista aceita só pré-vendas ativos cadastrados (vários, separados por vírgula).',
  'Valores monetários não podem ser negativos; orcamento_sigiloso=true esconde o orçamento no e-mail e no Planner.',
] as const

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
