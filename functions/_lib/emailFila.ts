/**
 * Processa a fila de e-mails (email_fila): lê o que está pendente, aplica as regras atuais do administrador e envia.
 * A rede fica atrás de `enviar` (SMTP no script, simulada nos testes). Nada aqui escreve e-mails nem dados no log.
 */
import type { Sql } from './cadastro.ts'
import { montarEmail, montarEmailTeste, type DadosEmail, type Mensagem } from './emailMsg.ts'

export type Envio = Mensagem & { to: string[]; cc: string[] }
export type Enviar = (e: Envio) => Promise<void>
export type Resumo = { pendentes: number; enviados: number; ignorados: number; novaTentativa: number; falhaDefinitiva: number }

type Item = DadosEmail & { id: number; tipo: 'nova' | 'teste'; tentativas: number; destino_teste: string | null }

/** Erro curto e sem endereços, para guardar na fila e mostrar na administração. */
export const resumoErro = (e: unknown) => {
  const x = (e ?? {}) as { code?: string; responseCode?: number; message?: string }
  const base = [x.code, x.responseCode].filter(Boolean).join(' ') || 'erro'
  const msg = String(x.message ?? '').replace(/[\w.+-]+@[\w.-]+/g, '<e-mail>').replace(/\s+/g, ' ').slice(0, 160)
  return `${base}: ${msg}`.slice(0, 200)
}

export async function processarFila(sql: Sql, enviar: Enviar, opc: { url: string; max?: number; tentativasMax?: number; simular?: boolean }): Promise<Resumo> {
  const max = opc.max ?? 50
  const tentativasMax = opc.tentativasMax ?? 5
  const r: Resumo = { pendentes: 0, enviados: 0, ignorados: 0, novaTentativa: 0, falhaDefinitiva: 0 }

  const itens = (await sql`
    select f.id, f.tipo, f.tentativas, f.destino_teste,
           o.codigo, o.orgao, o.status, o.torre, o.linha_servico, o.uf, o.data_pregao_dt::text as data_pregao_dt, o.analista,
           o.orcamento::float8 as orcamento, coalesce(o.orcamento_sigiloso, false) as orcamento_sigiloso, o.criado_por
    from email_fila f left join oportunidades o on o.id = f.oportunidade_id
    where f.situacao = 'pendente' and f.tentativas < ${tentativasMax}::int
    order by f.id limit ${max}::int`) as Item[]
  r.pendentes = itens.length
  if (!itens.length) return r

  const [cfg] = await sql`select ativo from email_config where id = 1`
  const dest = (await sql`select email, tipo from email_destinatarios where ativo order by email`) as { email: string; tipo: 'para' | 'cc' }[]
  const para = dest.filter((d) => d.tipo === 'para').map((d) => d.email)
  const cc = dest.filter((d) => d.tipo === 'cc').map((d) => d.email)

  for (const it of itens) {
    const ehTeste = it.tipo === 'teste'
    // Regras valem na hora do envio: se foi desligado (ou ficou sem destinatário) depois de entrar na fila, não envia.
    if (!ehTeste && (!cfg?.ativo || para.length === 0)) {
      if (!opc.simular) {
        const motivo = !cfg?.ativo ? 'Envio desligado quando chegou a vez' : 'Sem destinatário "para" ativo'
        await sql`update email_fila set situacao = 'ignorado', ultimo_erro = ${motivo} where id = ${it.id}::bigint`
      }
      r.ignorados++
      continue
    }
    const msg = ehTeste ? montarEmailTeste(opc.url) : montarEmail(it, opc.url)
    const envio: Envio = { ...msg, to: ehTeste ? [it.destino_teste as string] : para, cc: ehTeste ? [] : cc }
    if (opc.simular) {
      r.enviados++
      continue
    }
    // Conta a tentativa ANTES de enviar: se o processo morrer no meio, o limite de tentativas ainda vale.
    await sql`update email_fila set tentativas = tentativas + 1 where id = ${it.id}::bigint`
    try {
      await enviar(envio)
      await sql`update email_fila set situacao = 'enviado', enviado_em = now(), ultimo_erro = null where id = ${it.id}::bigint`
      r.enviados++
    } catch (e) {
      const definitiva = it.tentativas + 1 >= tentativasMax
      await sql`update email_fila set situacao = ${definitiva ? 'erro' : 'pendente'}, ultimo_erro = ${resumoErro(e)} where id = ${it.id}::bigint`
      if (definitiva) r.falhaDefinitiva++
      else r.novaTentativa++
    }
  }
  return r
}
