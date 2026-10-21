import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertTriangle, History, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CAMPO_LISTA, regrasNegocio, type ErroCampo, type Oportunidade } from '@/domain/oportunidade'
import { cn } from '@/lib/utils'
import { ApiError, useArquivar, useAtualizar, useCriar, useHistorico, type Me, type Opcoes } from './api'
import { SECOES, ROTULO, type Campo } from './campos'
import { dataHoraBr, deForm, paraForm, type FormValores } from './formato'

type Props = {
  aberto: boolean
  onFechar: () => void
  /** `null` = nova oportunidade. */
  registro: Oportunidade | null
  opcoes: Opcoes
  me: Me
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 aria-invalid:border-st-critical disabled:opacity-60'

function CampoInput({
  c,
  form,
  opcoes,
  erro,
  valorAtual,
  desabilitado,
}: {
  c: Campo
  form: ReturnType<typeof useForm<FormValores>>
  opcoes: Opcoes
  erro?: string
  valorAtual: string
  desabilitado?: boolean
}) {
  const id = `f-${c.nome}`
  const reg = form.register(c.nome as keyof FormValores)
  const comum = { id, 'aria-invalid': erro ? true : undefined, 'aria-describedby': erro ? `${id}-erro` : c.dica ? `${id}-dica` : undefined, disabled: desabilitado }
  let controle: React.ReactNode
  if (c.tipo === 'lista' || c.tipo === 'preVendas') {
    const lista = c.tipo === 'preVendas' ? opcoes.preVendas.map((valor) => ({ valor })) : (opcoes.listas[CAMPO_LISTA[c.nome as keyof typeof CAMPO_LISTA]] ?? []).filter((o) => o.ativo)
    // Valor antigo fora da lista (ex.: "Validar" vindo da planilha) continua visível até ser corrigido.
    const extra = valorAtual && !lista.some((o) => o.valor === valorAtual) ? [{ valor: valorAtual, fora: true }] : []
    controle = (
      <select className={inputCls} {...comum} {...reg}>
        <option value="">— selecione —</option>
        {[...lista, ...extra].map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.valor}
            {'fora' in o ? ' (fora da lista — corrija)' : ''}
          </option>
        ))}
      </select>
    )
  } else if (c.tipo === 'longo') {
    controle = <textarea rows={c.nome === 'descritivo' ? 3 : 4} className={cn(inputCls, 'resize-y')} {...comum} {...reg} />
  } else if (c.tipo === 'data') {
    controle = <input type="date" className={inputCls} {...comum} {...reg} />
  } else if (c.tipo === 'bool') {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" className="size-4 accent-[var(--gold)]" {...reg} {...comum} />
        {c.rotulo}
        {c.dica && <span className="text-xs text-muted">· {c.dica}</span>}
      </label>
    )
  } else {
    const modo = c.tipo === 'dinheiro' || c.tipo === 'percentual' ? 'decimal' : c.tipo === 'inteiro' ? 'numeric' : undefined
    controle = <input type="text" inputMode={modo} autoComplete="off" className={inputCls} {...comum} {...reg} />
  }
  return (
    <div className={c.largo ? 'sm:col-span-2' : undefined}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-ink-soft">
        {c.rotulo}
        {c.obrigatorio && <span aria-hidden className="text-st-critical"> *</span>}
      </label>
      {controle}
      {erro ? (
        <p id={`${id}-erro`} role="alert" className="mt-1 text-xs text-st-critical">{erro}</p>
      ) : c.dica ? (
        <p id={`${id}-dica`} className="mt-1 text-xs text-muted">{c.dica}</p>
      ) : null}
    </div>
  )
}

function PainelHistorico({ id }: { id: number }) {
  const { data, isPending, error } = useHistorico(id)
  if (isPending) return <p className="p-4 text-[13px] text-muted">Carregando histórico…</p>
  if (error) return <p className="p-4 text-[13px] text-st-critical">Não foi possível carregar o histórico.</p>
  if (!data.length) return <p className="p-4 text-[13px] text-muted">Sem alterações registradas.</p>
  return (
    <ol className="space-y-3 p-4">
      {data.map((h) => (
        <li key={h.id} className="rounded-lg border border-line-soft p-3 text-[13px]">
          <p className="font-semibold text-ink">
            {h.acao.charAt(0).toUpperCase() + h.acao.slice(1)} <span className="font-normal text-muted">· {h.por} · {dataHoraBr(h.em)}</span>
          </p>
          {Object.entries(h.alteracoes).length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-soft">
              {Object.entries(h.alteracoes).map(([campo, [de, para]]) => (
                <li key={campo}>
                  <span className="font-semibold">{ROTULO[campo] ?? campo}:</span> {String(de ?? '—')} → {String(para ?? '—')}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

export function OportunidadeDrawer({ aberto, onFechar, registro: registroProp, opcoes, me }: Props) {
  // `base` é a versão sobre a qual o usuário edita; após um conflito passa a ser a versão do servidor.
  const [base, setBase] = useState<Oportunidade | null>(registroProp)
  const registro = base
  const nova = registro === null
  const form = useForm<FormValores>({ defaultValues: paraForm(registro) })
  const [errosServidor, setErrosServidor] = useState<ErroCampo[]>([])
  const [conflito, setConflito] = useState<Oportunidade | null>(null)
  const [aba, setAba] = useState<'dados' | 'historico'>('dados')
  const criar = useCriar()
  const atualizar = useAtualizar()
  const arquivar = useArquivar()
  const status = form.watch('status')
  const sigiloso = form.watch('orcamento_sigiloso')

  useEffect(() => {
    if (aberto) {
      setBase(registroProp)
      form.reset(paraForm(registroProp))
      setErrosServidor([])
      setConflito(null)
      setAba('dados')
    }
  }, [aberto, registroProp, form])

  const erroDe = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of errosServidor) if (!m.has(e.campo)) m.set(e.campo, e.mensagem)
    return m
  }, [errosServidor])

  const salvando = criar.isPending || atualizar.isPending
  const arquivado = Boolean(registro?.arquivado_em)

  const submeter = form.handleSubmit(async (valores) => {
    setConflito(null)
    const parsed = deForm(valores, registro?.pendencias ?? [])
    if (!parsed.success) {
      setErrosServidor(parsed.error.issues.map((i) => ({ campo: String(i.path[0] ?? 'corpo'), mensagem: i.message })))
      return
    }
    const negocio = regrasNegocio(parsed.data)
    if (negocio.length) {
      setErrosServidor(negocio)
      toast.error('Corrija os campos destacados.')
      return
    }
    setErrosServidor([])
    try {
      const salvo = nova ? await criar.mutateAsync(parsed.data) : await atualizar.mutateAsync({ id: registro.id, versao: registro.versao, dados: parsed.data })
      toast.success(nova ? 'Oportunidade cadastrada.' : 'Alterações salvas.')
      if ('avisos' in salvo && salvo.avisos?.length) toast.warning('Já existe oportunidade com o mesmo processo, órgão, data e torre. Confira se não é duplicada.')
      onFechar()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.atual) setConflito(e.atual)
      else if (e instanceof ApiError && e.erros.length) setErrosServidor(e.erros)
      else toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')
    }
  })

  const alternarArquivo = async () => {
    if (!registro) return
    try {
      await arquivar.mutateAsync({ id: registro.id, restaurar: arquivado })
      toast.success(arquivado ? 'Oportunidade restaurada.' : 'Oportunidade arquivada.')
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.')
    }
  }

  const semCampo = errosServidor.filter((e) => !(e.campo in ROTULO))

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-100 bg-[rgba(10,14,24,.5)]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-101 flex w-full max-w-190 flex-col bg-surface shadow-card outline-none"
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="font-serif text-lg font-semibold text-ink">
                {nova ? 'Nova oportunidade' : `Oportunidade ${registro.codigo ?? `#${registro.id}`}`}
              </DialogPrimitive.Title>
              {!nova && (
                <p className="mt-0.5 text-xs text-muted">
                  v{registro.versao} · atualizada por {registro.atualizado_por ?? registro.criado_por ?? 'sistema'} em {dataHoraBr(registro.atualizado_em)}
                  {arquivado && <strong className="text-st-warn"> · ARQUIVADA</strong>}
                </p>
              )}
            </div>
            <DialogPrimitive.Close aria-label="Fechar" className="cursor-pointer rounded p-1 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-gold">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </header>

          {!nova && (
            <div role="tablist" aria-label="Seções da oportunidade" className="flex gap-1 border-b border-line px-5">
              {(['dados', 'historico'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={aba === t}
                  onClick={() => setAba(t)}
                  className={cn('-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13px] font-semibold', aba === t ? 'border-gold text-ink' : 'border-transparent text-muted hover:text-ink')}
                >
                  {t === 'dados' ? 'Dados' : <span className="inline-flex items-center gap-1"><History className="size-3.5" />Histórico</span>}
                </button>
              ))}
            </div>
          )}

          {aba === 'historico' && registro ? (
            <div className="flex-1 overflow-y-auto"><PainelHistorico id={registro.id} /></div>
          ) : (
            <form onSubmit={submeter} noValidate className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
                {conflito && (
                  <div role="alert" className="flex gap-2 rounded-lg border border-st-warn/50 bg-gold-soft p-3 text-[13px] text-ink">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-st-warn" />
                    <div>
                      <p className="font-semibold">Outra pessoa alterou este registro enquanto você editava.</p>
                      <p className="mt-0.5 text-ink-soft">Carregue a versão atual para não sobrescrever o trabalho dela; suas alterações neste formulário serão descartadas.</p>
                      <Button type="button" className="mt-2" onClick={() => { setBase(conflito); form.reset(paraForm(conflito)); setConflito(null); setErrosServidor([]) }}>
                        Descartar e recarregar
                      </Button>
                    </div>
                  </div>
                )}
                {registro?.pendencias?.length ? (
                  <div className="rounded-lg border border-st-warn/40 bg-gold-soft p-3 text-[13px] text-ink">
                    <strong>Pendências da migração:</strong> {registro.pendencias.map((p) => ROTULO[p] ?? p).join(', ')} — corrija e salve.
                  </div>
                ) : null}
                {semCampo.length > 0 && (
                  <div role="alert" className="rounded-lg border border-st-critical/40 p-3 text-[13px] text-st-critical">
                    {semCampo.map((e) => e.mensagem).join(' · ')}
                  </div>
                )}
                {SECOES.map((s) => {
                  const visiveis = s.campos.filter((c) => !c.quando || c.quando.includes(status) || Boolean(form.getValues(c.nome as keyof FormValores)))
                  return (
                    <fieldset key={s.id} className="min-w-0">
                      <legend className="mb-3 font-serif text-[15px] font-semibold text-ink">{s.titulo}</legend>
                      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                        {visiveis.map((c) => (
                          <CampoInput
                            key={c.nome}
                            c={c}
                            form={form}
                            opcoes={opcoes}
                            erro={erroDe.get(c.nome)}
                            valorAtual={String(form.getValues(c.nome as keyof FormValores) ?? '')}
                            desabilitado={(c.nome === 'orcamento' && sigiloso) || arquivado}
                          />
                        ))}
                      </div>
                    </fieldset>
                  )
                })}
              </div>
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
                <div>
                  {!nova && me.admin && (
                    <Button type="button" variant="dashed" onClick={alternarArquivo} disabled={arquivar.isPending}>
                      {arquivado ? 'Restaurar' : 'Arquivar'}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={onFechar}>Cancelar</Button>
                  <button
                    type="submit"
                    disabled={salvando || arquivado}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-4 py-[7px] text-[13px] font-semibold text-page transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"
                  >
                    {salvando && <Loader2 className="size-3.5 animate-spin" />}
                    {nova ? 'Cadastrar' : 'Salvar alterações'}
                  </button>
                </div>
              </footer>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
