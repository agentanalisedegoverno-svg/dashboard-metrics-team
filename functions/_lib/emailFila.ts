/**
 * Processa a fila de e-mails (email_fila): lê o que está pendente, aplica as regras atuais do administrador e envia.
 * A rede fica atrás de `enviar` (SMTP no script, simulada nos testes). Nada aqui escreve e-mails nem dados no log.
 */
import { nomesPreVendas } from '../../src/domain/preVendas.ts'
import type { Sql } from './cadastro.ts'
import { montarEmail, montarEmailTeste, type DadosEmail, type Mensagem } from './emailMsg.ts'

export type Envio = Mensagem & { to: string[]; cc: string[] }
export type Enviar = (e: Envio) => Promise<void>
export type Resumo = { pendentes: number; enviados: number; ignorados: number; novaTentativa: number; falhaDefinitiva: number; emOutroProcesso: number }

type Item = DadosEmail & { id: number; tipo: 'nova' | 'status' | 'teste'; tentativas: number; destino_teste: string | null }

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
  const r: Resumo = { pendentes: 0, enviados: 0, ignorados: 0, novaTentativa: 0, falhaDefinitiva: 0, emOutroProcesso: 0 }

  const itens = (await sql`
    select f.id, f.tipo, f.tentativas, f.destino_teste, case when f.tipo = 'status' then coalesce(f.status_anterior, '') end as status_anterior, f.alterado_por,
           o.codigo, o.orgao, o.descritivo, o.objeto, o.processo, o.uasg, coalesce(f.status_novo, o.status) as status, o.torre, o.linha_servico, o.uf, o.data_pregao_dt::text as data_pregao_dt, o.hora_pregao::text as hora_pregao, o.analista,
           o.orcamento::float8 as orcamento, coalesce(o.orcamento_sigiloso, false) as orcamento_sigiloso, o.criado_por
    from email_fila f left join oportunidades o on o.id = f.oportunidade_id
    where f.situacao = 'pendente' and f.tentativas < ${tentativasMax}::int
    order by f.id limit ${max}::int`) as Item[]
  r.pendentes = itens.length
  if (!itens.length) return r

  const [cfg] = await sql`select ativo, avisar_pre_vendas from email_config where id = 1`
  const dest = (await sql`select email, tipo from email_destinatarios where ativo order by email`) as { email: string; tipo: 'para' | 'cc' }[]
  const para = dest.filter((d) => d.tipo === 'para').map((d) => d.email)
  const cc = dest.filter((d) => d.tipo === 'cc').map((d) => d.email)
  // Pré-vendas: só quem está ativo e tem e-mail cadastrado (a busca é por nome, igual ao que a oportunidade guarda).
  const emailPorNome = new Map<string, string>()
  if (cfg?.avisar_pre_vendas) {
    const us = (await sql`select nome, email from usuarios where ativo and email is not null`) as { nome: string; email: string }[]
    for (const u of us) emailPorNome.set(u.nome, u.email.toLowerCase())
  }

  for (const it of itens) {
    const ehTeste = it.tipo === 'teste'
    // Regras valem na hora do envio: se foi desligado (ou ficou sem destinatário) depois de entrar na fila, não envia.
    const doPreVendas = ehTeste ? [] : nomesPreVendas(it.analista).map((n) => emailPorNome.get(n)).filter((x): x is string => !!x)
    // Cada pré-vendas entra em "Para", a menos que já esteja na lista (para ou cópia): ninguém recebe duas vezes.
    const paraItem = [...new Set([...para, ...doPreVendas.filter((x) => !para.includes(x) && !cc.includes(x))])]
    if (!ehTeste && (!cfg?.ativo || paraItem.length === 0)) {
      if (!opc.simular) {
        const motivo = !cfg?.ativo ? 'Envio desligado quando chegou a vez' : 'Sem destinatário "para" ativo'
        await sql`update email_fila set situacao = 'ignorado', ultimo_erro = ${motivo} where id = ${it.id}::bigint`
      }
      r.ignorados++
      continue
    }
    const msg = ehTeste ? montarEmailTeste(opc.url) : montarEmail(it, opc.url)
    const envio: Envio = { ...msg, to: ehTeste ? [it.destino_teste as string] : paraItem, cc: ehTeste ? [] : cc }
    if (opc.simular) {
      r.enviados++
      continue
    }
    // Conta a tentativa ANTES de enviar (se o processo morrer no meio, o limite de tentativas ainda vale) e, no mesmo passo,
    // "pega" o pedido: se a máquina do time e o GitHub rodarem ao mesmo tempo, só um deles consegue e o outro pula (nada sai em dobro).
    const pegou = await sql`update email_fila set tentativas = tentativas + 1
      where id = ${it.id}::bigint and situacao = 'pendente' and tentativas = ${it.tentativas}::int returning id`
    if (!pegou.length) {
      r.emOutroProcesso++
      continue
    }
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
