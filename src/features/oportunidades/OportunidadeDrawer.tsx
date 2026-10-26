import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertTriangle, History, Loader2, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formataCnpj, soDigitos, validaCnpj } from '@/domain/cnpj'
import { CAMPO_LISTA, regrasNegocio, torreDaLinha, type ErroCampo, type Oportunidade } from '@/domain/oportunidade'
import { cn } from '@/lib/utils'
import { ApiError, useArquivar, useAtualizar, useConsultaCnpj, useCriar, useHistorico, type Me, type Opcoes } from './api'
import { SECOES, ROTULO, TIPO_CAMPO, type Campo } from './campos'
import { dataHoraBr, deForm, paraForm, pct, type FormValores } from './formato'

type Props = {
  aberto: boolean
  onFechar: () => void
  /** `null` = nova oportunidade. */
  registro: Oportunidade | null
  opcoes: Opcoes
  me: Me
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 aria-invalid:border-st-critical disabled:cursor-default disabled:border-line-soft disabled:bg-surface-2 disabled:text-ink disabled:opacity-100'

/** Empresa vencedora: digita-se só o CNPJ; razão social e matriz/filial vêm da Receita Federal (via API do Radar). */
function CampoCnpj({
  c,
  form,
  erro,
  desabilitado,
}: {
  c: Campo
  form: ReturnType<typeof useForm<FormValores>>
  erro?: string
  desabilitado?: boolean
}) {
  const consulta = useConsultaCnpj()
  const id = `f-${c.nome}`
  const valor = form.watch('empresa_vencedora_cnpj') ?? ''
  const razao = form.watch('empresa_vencedora_razao')
  const tipo = form.watch('empresa_vencedora_tipo')
  const legado = form.getValues('empresas_vencedoras')
  const [aviso, setAviso] = useState<{ nivel: 'erro' | 'aviso'; texto: string } | null>(null)

  const limpar = () => {
    form.setValue('empresa_vencedora_razao', '', { shouldDirty: true })
    form.setValue('empresa_vencedora_tipo', '', { shouldDirty: true })
  }
  const aoDigitar = (texto: string) => {
    const mascara = formataCnpj(texto)
    form.setValue('empresa_vencedora_cnpj', mascara, { shouldDirty: true })
    setAviso(null)
    const d = soDigitos(mascara)
    if (d.length < 14) return limpar()
    if (!validaCnpj(d)) {
      limpar()
      return setAviso({ nivel: 'erro', texto: 'CNPJ inválido (confira os dígitos).' })
    }
    consulta.mutate(d, {
      onSuccess: (e) => {
        form.setValue('empresa_vencedora_razao', e.razao_social, { shouldDirty: true })
        form.setValue('empresa_vencedora_tipo', e.tipo, { shouldDirty: true })
      },
      onError: (e) => {
        limpar()
        const status = e instanceof ApiError ? e.status : 0
        setAviso(
          status === 404 || status === 422
            ? { nivel: 'erro', texto: e.message }
            : { nivel: 'aviso', texto: 'Receita indisponível agora. Você pode salvar: a razão social é consultada de novo no salvamento.' },
        )
      },
    })
  }

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-ink-soft">{c.rotulo}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="00.000.000/0000-00"
        value={valor}
        disabled={desabilitado}
        aria-invalid={erro || aviso?.nivel === 'erro' ? true : undefined}
        aria-describedby={`${id}-info`}
        onChange={(e) => aoDigitar(e.target.value)}
        className={inputCls}
      />
      <div id={`${id}-info`} aria-live="polite" className="mt-1 text-xs">
        {consulta.isPending ? (
          <p className="text-muted">Consultando a Receita Federal…</p>
        ) : razao ? (
          <p className="text-ink">
            <strong>{razao}</strong> · <span className="rounded bg-line-soft px-1.5 py-0.5 font-semibold">{tipo || '—'}</span>
          </p>
        ) : null}
        {aviso && <p role={aviso.nivel === 'erro' ? 'alert' : 'status'} className={aviso.nivel === 'erro' ? 'text-st-critical' : 'text-st-warn'}>{aviso.texto}</p>}
        {erro && <p role="alert" className="text-st-critical">{erro}</p>}
        {!razao && !aviso && !erro && !consulta.isPending && c.dica && <p className="text-muted">{c.dica}</p>}
        {legado && <p className="mt-1 text-muted">Registro anterior (texto): {legado}</p>}
      </div>
    </div>
  )
}

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
  if (c.tipo === 'cnpj') return <CampoCnpj c={c} form={form} erro={erro} desabilitado={desabilitado} />
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
  } else if (c.tipo === 'hora') {
    controle = <input type="time" className={inputCls} {...comum} {...reg} />
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
    <div className={c.largo ? 'sm:col-span-2 lg:col-span-3' : undefined}>
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

/** Percentuais chegam do banco como fração (0,0865): no histórico aparecem como 8,65%. */
const valorHistorico = (campo: string, v: unknown) =>
  TIPO_CAMPO[campo] === 'percentual' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? pct(Number(v)) : String(v ?? '—')

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
                  <span className="font-semibold">{ROTULO[campo] ?? campo}:</span> {valorHistorico(campo, de)} → {valorHistorico(campo, para)}
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
  // Registro existente abre TRAVADO (só leitura); "Editar" libera. Oportunidade nova abre direto em edição.
  const [editando, setEditando] = useState(registroProp === null)
  const [confirmaDescarte, setConfirmaDescarte] = useState(false)
  const [fecharAoDescartar, setFecharAoDescartar] = useState(false)
  const criar = useCriar()
  const atualizar = useAtualizar()
  const arquivar = useArquivar()
  const status = form.watch('status')
  const sigiloso = form.watch('orcamento_sigiloso')
  const linha = form.watch('linha_servico')
  const sujo = form.formState.isDirty // lido na renderização para o React Hook Form acompanhar

  // Torre é calculada pela linha de serviço (regra da planilha): ao escolher a linha, a torre acompanha.
  useEffect(() => {
    const t = torreDaLinha(opcoes.linhasTorre ?? {}, linha)
    if (t && form.getValues('torre') !== t) form.setValue('torre', t, { shouldDirty: true })
  }, [linha, opcoes.linhasTorre, form])

  useEffect(() => {
    if (aberto) {
      setBase(registroProp)
      form.reset(paraForm(registroProp))
      setErrosServidor([])
      setConflito(null)
      setAba('dados')
      setEditando(registroProp === null)
      setConfirmaDescarte(false)
      setFecharAoDescartar(false)
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
      setBase(salvo)
      form.reset(paraForm(salvo))
      setEditando(false)
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

  const descartarEdicao = () => {
    setConfirmaDescarte(false)
    setErrosServidor([])
    setConflito(null)
    if (nova || fecharAoDescartar) return onFechar()
    form.reset(paraForm(registro))
    setEditando(false)
  }
  const cancelar = () => {
    setFecharAoDescartar(false)
    if (sujo) setConfirmaDescarte(true)
    else descartarEdicao()
  }
  const tentarFechar = () => {
    if (editando && sujo) {
      setFecharAoDescartar(true)
      setConfirmaDescarte(true)
    } else onFechar()
  }
  const travado = !editando || arquivado

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={(o) => !o && tentarFechar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed inset-0 z-101 flex flex-col bg-surface outline-none">
          <header className="border-b border-line">
            <div className="mx-auto flex w-full max-w-350 items-start justify-between gap-3 px-5 py-4">
              <div>
                <DialogPrimitive.Title className="font-serif text-xl font-semibold text-ink">
                  {nova ? 'Nova oportunidade' : `Oportunidade ${registro.codigo ?? `#${registro.id}`}`}
                </DialogPrimitive.Title>
                {!nova && (
                  <p className="mt-0.5 text-xs text-muted">
                    v{registro.versao} · atualizada por {registro.atualizado_por ?? registro.criado_por ?? 'sistema'} em {dataHoraBr(registro.atualizado_em)}
                    {arquivado && <strong className="text-st-warn"> · ARQUIVADA</strong>}
                    {editando && <strong className="text-gold"> · EDITANDO</strong>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!nova && !editando && !arquivado && !me.somenteLeitura && (
                  <button
                    type="button"
                    onClick={() => setEditando(true)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-4 py-[7px] text-[13px] font-semibold text-page transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                  >
                    <Pencil className="size-3.5" /> Editar
                  </button>
                )}
                {!nova && !editando && me.admin && (
                  <Button type="button" variant="dashed" onClick={alternarArquivo} disabled={arquivar.isPending}>
                    {arquivado ? 'Restaurar' : 'Arquivar'}
                  </Button>
                )}
                <button
                  type="button"
                  aria-label="Fechar"
                  onClick={tentarFechar}
                  className="cursor-pointer rounded p-1 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-gold"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {!nova && (
              <div role="tablist" aria-label="Seções da oportunidade" className="mx-auto flex w-full max-w-350 gap-1 px-5">
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
          </header>

          {aba === 'historico' && registro ? (
            <div className="flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-350"><PainelHistorico id={registro.id} /></div></div>
          ) : (
            <form onSubmit={submeter} noValidate className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-350 space-y-6 px-5 py-5">
                  {confirmaDescarte && (
                    <div role="alertdialog" aria-label="Descartar alterações" className="flex flex-wrap items-center gap-3 rounded-lg border border-st-warn/50 bg-gold-soft p-3 text-[13px] text-ink">
                      <AlertTriangle className="size-4 shrink-0 text-st-warn" />
                      <p className="flex-1 font-semibold">Há alterações não salvas. Descartar?</p>
                      <Button type="button" onClick={() => setConfirmaDescarte(false)}>Continuar editando</Button>
                      <Button type="button" onClick={descartarEdicao}>Descartar</Button>
                    </div>
                  )}
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
                      <strong>Pendências da migração:</strong> {registro.pendencias.map((p) => ROTULO[p] ?? p).join(', ')} — {editando ? 'corrija e salve.' : 'clique em Editar para corrigir.'}
                    </div>
                  ) : null}
                  {semCampo.length > 0 && (
                    <div role="alert" className="rounded-lg border border-st-critical/40 p-3 text-[13px] text-st-critical">
                      {semCampo.map((e) => e.mensagem).join(' · ')}
                    </div>
                  )}
                  {SECOES.map((sec) => {
                    const visiveis = sec.campos.filter((c) => !c.quando || c.quando.includes(status) || Boolean(form.getValues(c.nome as keyof FormValores)))
                    return (
                      <fieldset key={sec.id} className="min-w-0">
                        <legend className="mb-3 font-serif text-[15px] font-semibold text-ink">{sec.titulo}</legend>
                        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                          {visiveis.map((c) => (
                            <CampoInput
                              key={c.nome}
                              c={c}
                              form={form}
                              opcoes={opcoes}
                              erro={erroDe.get(c.nome)}
                              valorAtual={String(form.getValues(c.nome as keyof FormValores) ?? '')}
                              desabilitado={travado || (c.nome === 'orcamento' && sigiloso) || (c.nome === 'torre' && Boolean(linha))}
                            />
                          ))}
                        </div>
                      </fieldset>
                    )
                  })}
                </div>
              </div>
              {editando && !arquivado && (
                <footer className="border-t border-line">
                  <div className="mx-auto flex w-full max-w-350 items-center justify-end gap-2 px-5 py-3">
                    <Button type="button" onClick={cancelar}>Cancelar</Button>
                    <button
                      type="submit"
                      disabled={salvando}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-4 py-[7px] text-[13px] font-semibold text-page transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"
                    >
                      {salvando && <Loader2 className="size-3.5 animate-spin" />}
                      {nova ? 'Cadastrar' : 'Salvar alterações'}
                    </button>
                  </div>
                </footer>
              )}
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
