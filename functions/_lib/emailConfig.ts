/** Casos de uso da configuração de e-mail das novas oportunidades (só administradores). A regra mora no banco. */
import { emailConfigInput, type EmailConfig } from '../../src/domain/email.ts'
import { errosZod } from '../../src/domain/oportunidade.ts'
import type { Sql } from './cadastro.ts'
import { erroBanco, send } from './http.ts'

const negado = () => send(403, { error: 'Somente administradores configuram o envio de e-mails.' })

export async function lerEmailConfig(sql: Sql, email: string) {
  const [{ admin }] = await sql`select eh_admin(${email}) as admin`
  if (!admin) return negado()
  const [c] = await sql`select ativo, status_gatilho, atualizado_por, atualizado_em from email_config where id = 1`
  const dest = await sql`select email, tipo, ativo from email_destinatarios order by email`
  const recentes = await sql`
    select f.id, f.tipo, f.situacao, f.tentativas, f.ultimo_erro, f.criado_em, f.enviado_em, o.codigo, o.orgao
    from email_fila f left join oportunidades o on o.id = f.oportunidade_id
    order by f.id desc limit 15`
  const corpo: EmailConfig = {
    ativo: Boolean(c?.ativo),
    status: c?.status_gatilho ?? [],
    destinatarios: dest,
    atualizado_por: c?.atualizado_por ?? null,
    atualizado_em: c?.atualizado_em ?? null,
    recentes,
  }
  return send(200, corpo)
}

export async function salvarEmailConfig(sql: Sql, email: string, corpo: unknown) {
  const parsed = emailConfigInput.safeParse(corpo)
  if (!parsed.success) return send(422, { error: 'Dados inválidos.', erros: errosZod(parsed.error) })
  const c = parsed.data
  try {
    await sql`select salvar_email_config(${c.ativo}, ${c.status}::text[], ${JSON.stringify(c.destinatarios)}::jsonb, ${email})`
    return send(200, { ok: true })
  } catch (e) {
    return erroBanco(e)
  }
}

export async function pedirEmailTeste(sql: Sql, email: string) {
  try {
    await sql`select enfileirar_email_teste(${email})`
    return send(200, { ok: true })
  } catch (e) {
    return erroBanco(e)
  }
}
