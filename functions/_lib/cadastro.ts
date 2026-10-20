/**
 * Casos de uso do cadastro de oportunidades. Cada função recebe o cliente SQL (tagged template do Neon)
 * e devolve uma Response; as regras de negócio ficam no banco (funções SECURITY DEFINER).
 */
import { atualizacaoInput, errosZod, opcaoInput, oportunidadeInput, usuarioInput } from '../../src/domain/oportunidade.ts'
import { erroBanco, send } from './http.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sql = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>

const idValido = (id: string) => /^\d{1,15}$/.test(id)
const invalido = (error: Parameters<typeof errosZod>[0]) => send(422, { error: 'Dados inválidos.', erros: errosZod(error) })

export async function me(sql: Sql, email: string) {
  const [u] = await sql`select nome, admin, pre_vendas from usuarios where email = ${email} and ativo`
  return send(200, { email, nome: u?.nome ?? null, admin: u?.admin ?? false, preVendas: u?.pre_vendas ?? false })
}

export async function listar(sql: Sql, email: string, incluirArquivadas: boolean) {
  const [{ admin }] = await sql`select eh_admin(${email}) as admin`
  const arquivadas = incluirArquivadas && admin
  const [{ rows }] = await sql`
    select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb) as rows
    from oportunidades o where ${arquivadas} or (o.arquivado_em is null and not o.ausente_na_planilha)`
  return send(200, { rows })
}

export async function obter(sql: Sql, id: string) {
  if (!idValido(id)) return send(404, { error: 'Oportunidade não encontrada.' })
  const [r] = await sql`select to_jsonb(o) as r from oportunidades o where o.id = ${id}::bigint`
  return r ? send(200, r.r) : send(404, { error: 'Oportunidade não encontrada.' })
}

export async function historico(sql: Sql, id: string) {
  if (!idValido(id)) return send(404, { error: 'Oportunidade não encontrada.' })
  const [{ itens }] = await sql`
    select coalesce(jsonb_agg(to_jsonb(h) order by h.em desc, h.id desc), '[]'::jsonb) as itens
    from oportunidades_historico h where h.oportunidade_id = ${id}::bigint`
  return send(200, { itens })
}

export async function criar(sql: Sql, email: string, corpo: unknown) {
  const parsed = oportunidadeInput.safeParse(corpo)
  if (!parsed.success) return invalido(parsed.error)
  const d = parsed.data
  try {
    const duplicadas = d.processo
      ? await sql`
          select id from oportunidades
          where arquivado_em is null and lower(processo) = lower(${d.processo})
            and lower(orgao) = lower(${d.orgao ?? ''}) and data_pregao_dt is not distinct from ${d.data_pregao_dt}::date
            and lower(coalesce(torre, '')) = lower(${d.torre ?? ''})
          limit 5`
      : []
    const [{ o }] = await sql`select criar_oportunidade(${JSON.stringify(d)}::jsonb, ${email}) as o`
    const avisos = duplicadas.length ? [{ regra: 'possivel_duplicata', ids: duplicadas.map((x: { id: number }) => x.id) }] : []
    return send(201, { ...o, avisos })
  } catch (e) {
    return erroBanco(e)
  }
}

export async function atualizar(sql: Sql, email: string, id: string, corpo: unknown) {
  if (!idValido(id)) return send(404, { error: 'Oportunidade não encontrada.' })
  const parsed = atualizacaoInput.safeParse(corpo)
  if (!parsed.success) return invalido(parsed.error)
  const { versao, ...campos } = parsed.data
  try {
    const [{ o }] = await sql`select atualizar_oportunidade(${id}::bigint, ${versao}::int, ${JSON.stringify(campos)}::jsonb, ${email}) as o`
    return send(200, o)
  } catch (e) {
    return erroBanco(e)
  }
}

export async function arquivar(sql: Sql, email: string, id: string, restaurar: boolean) {
  if (!idValido(id)) return send(404, { error: 'Oportunidade não encontrada.' })
  try {
    const [{ o }] = await sql`select arquivar_oportunidade(${id}::bigint, ${email}, ${restaurar}) as o`
    return send(200, o)
  } catch (e) {
    return erroBanco(e)
  }
}

export async function opcoes(sql: Sql, email: string) {
  const [{ admin }] = await sql`select eh_admin(${email}) as admin`
  const lista = (await sql`select lista, valor, ativo, ordem from opcoes order by lista, ordem, valor`) as {
    lista: string
    valor: string
    ativo: boolean
    ordem: number
  }[]
  const listas: Record<string, { valor: string; ativo: boolean; ordem: number }[]> = {}
  for (const o of lista) (listas[o.lista] ??= []).push({ valor: o.valor, ativo: o.ativo, ordem: o.ordem })
  const usuarios = (await sql`select nome, email, admin, pre_vendas, ativo from usuarios order by nome`) as {
    nome: string
    email: string | null
    admin: boolean
    pre_vendas: boolean
    ativo: boolean
  }[]
  return send(200, {
    listas,
    preVendas: usuarios.filter((u) => u.pre_vendas && u.ativo).map((u) => u.nome),
    // E-mails e papéis só para administradores.
    usuarios: admin ? usuarios : undefined,
  })
}

export async function salvarOpcao(sql: Sql, email: string, corpo: unknown) {
  const parsed = opcaoInput.safeParse(corpo)
  if (!parsed.success) return invalido(parsed.error)
  const o = parsed.data
  try {
    await sql`select salvar_opcao(${o.lista}, ${o.valor}, ${o.ativo}, ${o.ordem}::int, ${email})`
    return send(200, { ok: true })
  } catch (e) {
    return erroBanco(e)
  }
}

export async function salvarUsuario(sql: Sql, email: string, corpo: unknown) {
  const parsed = usuarioInput.safeParse(corpo)
  if (!parsed.success) return invalido(parsed.error)
  const u = parsed.data
  try {
    await sql`select salvar_usuario(${u.nome}, ${u.email}, ${u.admin}, ${u.pre_vendas}, ${u.ativo}, ${email})`
    return send(200, { ok: true })
  } catch (e) {
    return erroBanco(e)
  }
}
