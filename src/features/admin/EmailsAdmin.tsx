import { Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Destinatario, EmailConfigInput, EnvioRecente } from '@/domain/email'
import { cn } from '@/lib/utils'
import { ApiError, useEmailConfig, useEmailTeste, useSalvarEmailConfig, type Opcoes } from '../oportunidades/api'
import { dataHoraBr } from '../oportunidades/formato'

const campo = 'rounded-lg border border-line bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-60'
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const SITUACAO: Record<EnvioRecente['situacao'], string> = {
  pendente: 'Aguardando envio',
  enviado: 'Enviado',
  erro: 'Falhou',
  ignorado: 'Não enviado',
}

const mensagemErro = (e: unknown) =>
  e instanceof ApiError && e.erros.length ? e.erros.map((x) => x.mensagem).join(' · ') : e instanceof Error ? e.message : 'Não foi possível salvar.'

/** Administração → E-mails: quem recebe o aviso de nova oportunidade e a partir de quais status. */
export function EmailsAdmin({ opcoes }: { opcoes: Opcoes }) {
  const { data, isPending, error } = useEmailConfig()
  const salvar = useSalvarEmailConfig()
  const teste = useEmailTeste()
  const [edit, setEdit] = useState<EmailConfigInput | null>(null)
  const [novo, setNovo] = useState('')
  const [novoTipo, setNovoTipo] = useState<Destinatario['tipo']>('para')
  const [erroForm, setErroForm] = useState<string | null>(null)

  if (isPending) return <p className="text-[13px] text-muted">Carregando configuração de e-mails…</p>
  if (error || !data) {
    return <div role="alert" className="rounded-[10px] border border-st-critical/40 bg-surface p-4 text-[13px] text-ink-soft">Não foi possível carregar a configuração de e-mails. {error?.message}</div>
  }

  const servidor: EmailConfigInput = { ativo: data.ativo, avisar_pre_vendas: data.avisar_pre_vendas, status: data.status, destinatarios: data.destinatarios }
  const atual = edit ?? servidor
  const sujo = edit !== null && JSON.stringify(edit) !== JSON.stringify(servidor)
  const statusDisponiveis = (opcoes.listas.status ?? []).filter((o) => o.ativo).map((o) => o.valor)
  // Status marcados que saíram da lista de opções continuam visíveis para não esconder regra.
  const statusTodos = [...statusDisponiveis, ...atual.status.filter((s) => !statusDisponiveis.includes(s))]
  const muda = (parcial: Partial<EmailConfigInput>) => {
    setErroForm(null)
    setEdit({ ...atual, ...parcial })
  }

  const adicionar = () => {
    const email = novo.trim().toLowerCase()
    if (!EMAIL_OK.test(email)) return setErroForm('Informe um e-mail válido.')
    if (atual.destinatarios.some((d) => d.email === email)) return setErroForm('Este e-mail já está na lista.')
    muda({ destinatarios: [...atual.destinatarios, { email, tipo: novoTipo, ativo: true }] })
    setNovo('')
  }
  const altera = (email: string, p: Partial<Destinatario>) => muda({ destinatarios: atual.destinatarios.map((d) => (d.email === email ? { ...d, ...p } : d)) })

  const gravar = () =>
    salvar.mutate(atual, {
      onSuccess: () => {
        toast.success('Configuração de e-mails salva.')
        setEdit(null)
        setErroForm(null)
      },
      onError: (e) => setErroForm(mensagemErro(e)),
    })

  const pedirTeste = () =>
    teste.mutate(undefined, {
      onSuccess: () => toast.success('Teste na fila: chega ao seu e-mail em alguns minutos.'),
      onError: (e) => toast.error(mensagemErro(e)),
    })

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold text-ink">E-mails de nova oportunidade</h2>
          <p className="mt-0.5 max-w-[70ch] text-xs text-muted">
            Quando uma oportunidade é <strong>cadastrada pelo Radar</strong> com um dos status marcados abaixo, um aviso é enviado aos destinatários. A carga da planilha{' '}
            <strong>não</strong> envia e-mail. O envio roda a cada poucos minutos, então o aviso chega com pequeno atraso.
          </p>
        </div>
        <Button type="button" onClick={pedirTeste} disabled={teste.isPending}>
          <Send className="size-4" aria-hidden /> Enviar e-mail de teste para mim
        </Button>
      </div>

      <section className="mt-4 rounded-[10px] border border-line bg-surface p-4" aria-label="Regras de envio">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink">
          <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={atual.ativo} onChange={(e) => muda({ ativo: e.target.checked })} />
          Enviar e-mail a cada nova oportunidade
          <span className={cn('rounded px-1.5 py-0.5 text-[11px]', atual.ativo ? 'bg-line-soft text-ink' : 'bg-line-soft text-muted')}>{atual.ativo ? 'ligado' : 'desligado'}</span>
        </label>

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px] text-ink-soft">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--gold)]" checked={atual.avisar_pre_vendas} onChange={(e) => muda({ avisar_pre_vendas: e.target.checked })} />
          <span>
            <strong className="text-ink">Avisar também o pré-vendas da oportunidade</strong>
            <span className="block text-xs text-muted">O aviso vai ao e-mail do pré-vendas escolhido naquela oportunidade, além da lista abaixo. Só se ele tiver e-mail cadastrado em Usuários e perfis; quem já está na lista não recebe duas vezes.</span>
          </span>
        </label>

        <fieldset className="mt-4">
          <legend className="text-xs font-semibold text-ink-soft">Enviar quando o status da nova oportunidade for</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {statusTodos.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-soft">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--gold)]"
                  checked={atual.status.includes(s)}
                  onChange={(e) => muda({ status: e.target.checked ? [...atual.status, s] : atual.status.filter((x) => x !== s) })}
                />
                {s}
              </label>
            ))}
            {statusTodos.length === 0 && <span className="text-xs text-muted">Sem status cadastrados.</span>}
          </div>
        </fieldset>

        <div className="mt-5">
          <h3 className="text-xs font-semibold text-ink-soft">Destinatários</h3>
          <form
            noValidate
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              adicionar()
            }}
          >
            <label className="min-w-64 flex-1 text-xs font-semibold text-ink-soft">
              E-mail
              <input className={cn(campo, 'mt-1 w-full')} type="email" value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="nome@ctctech.com.br" maxLength={254} />
            </label>
            <label className="text-xs font-semibold text-ink-soft">
              Como
              <select aria-label="Tipo do novo destinatário" className={cn(campo, 'mt-1 block')} value={novoTipo} onChange={(e) => setNovoTipo(e.target.value as Destinatario['tipo'])}>
                <option value="para">Para</option>
                <option value="cc">Cópia (Cc)</option>
              </select>
            </label>
            <Button type="submit">
              <Plus className="size-4" aria-hidden /> Adicionar
            </Button>
          </form>

          <div className="mt-3 overflow-x-auto rounded-[10px] border border-line">
            <table className="w-full min-w-120 border-collapse text-[13px]">
              <caption className="sr-only">Destinatários dos e-mails de nova oportunidade</caption>
              <thead className="bg-surface-2 text-xs text-ink-soft">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">E-mail</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Como</th>
                  <th scope="col" className="px-3 py-2 text-center font-semibold">Ativo</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold"><span className="sr-only">Remover</span></th>
                </tr>
              </thead>
              <tbody>
                {atual.destinatarios.map((d) => (
                  <tr key={d.email} className="border-t border-line-soft">
                    <td className={cn('px-3 py-2', !d.ativo && 'text-muted line-through')}>{d.email}</td>
                    <td className="px-3 py-2">
                      <select aria-label={`Como enviar para ${d.email}`} className={campo} value={d.tipo} onChange={(e) => altera(d.email, { tipo: e.target.value as Destinatario['tipo'] })}>
                        <option value="para">Para</option>
                        <option value="cc">Cópia (Cc)</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" aria-label={`${d.email} está ativo`} className="size-4 accent-[var(--gold)]" checked={d.ativo} onChange={(e) => altera(d.email, { ativo: e.target.checked })} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button type="button" variant="ghost" aria-label={`Remover ${d.email}`} onClick={() => muda({ destinatarios: atual.destinatarios.filter((x) => x.email !== d.email) })}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                ))}
                {atual.destinatarios.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">Nenhum destinatário cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {erroForm && <p role="alert" className="mt-3 text-xs text-st-critical">{erroForm}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={gravar} disabled={!sujo || salvar.isPending}>Salvar configuração</Button>
          <Button type="button" onClick={() => { setEdit(null); setErroForm(null) }} disabled={!sujo || salvar.isPending}>Descartar alterações</Button>
          {sujo && <span className="text-xs text-muted">Há alterações não salvas.</span>}
          {!sujo && data.atualizado_por && <span className="text-xs text-muted">Última alteração por {data.atualizado_por} em {dataHoraBr(data.atualizado_em)}.</span>}
        </div>
      </section>

      <section className="mt-6" aria-label="Envios recentes">
        <h3 className="text-xs font-semibold text-ink-soft">Envios recentes</h3>
        <div className="mt-2 overflow-x-auto rounded-[10px] border border-line bg-surface" role="region" aria-label="Tabela de envios recentes" tabIndex={0}>
          <table className="w-full min-w-150 border-collapse text-[13px]">
            <caption className="sr-only">Últimos e-mails na fila de envio</caption>
            <thead className="bg-surface-2 text-xs text-ink-soft">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Quando</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Oportunidade</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Situação</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {data.recentes.map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className="px-3 py-2">{dataHoraBr(r.criado_em)}</td>
                  <td className="px-3 py-2">{r.tipo === 'teste' ? <em className="text-muted">E-mail de teste</em> : `${r.codigo ?? ''} ${r.orgao ?? ''}`.trim() || '—'}</td>
                  <td className="px-3 py-2 font-semibold">{SITUACAO[r.situacao]}</td>
                  <td className="px-3 py-2 text-xs text-muted">{r.ultimo_erro ?? (r.enviado_em ? `Enviado em ${dataHoraBr(r.enviado_em)}` : '')}</td>
                </tr>
              ))}
              {data.recentes.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">Nenhum e-mail na fila ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
