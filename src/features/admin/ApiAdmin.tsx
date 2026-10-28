import { Copy, KeyRound, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ApiError, useApiClientes, useCriarApiCliente, useRevogarApiCliente, type Opcoes } from '../oportunidades/api'
import { ApiDocs } from './ApiDocs'
import { dataHoraBr } from '../oportunidades/formato'

const campo = 'rounded-lg border border-line bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-60'
const NOME_OK = /^[a-z0-9][a-z0-9_-]{2,39}$/

const mensagemErro = (e: unknown) =>
  e instanceof ApiError && e.erros.length ? e.erros.map((x) => x.mensagem).join(' · ') : e instanceof Error ? e.message : 'Não foi possível concluir.'

/** Administração → API: chaves das aplicações externas e a documentação de como chamar. */
export function ApiAdmin({ opcoes }: { opcoes: Opcoes }) {
  const [aba, setAba] = useState<'chaves' | 'docs'>('chaves')
  return (
    <div>
      <div role="tablist" aria-label="API" className="mb-4 flex gap-1 border-b border-line">
        {(
          [
            ['chaves', 'Chaves'],
            ['docs', 'Como chamar (documentação)'],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            onClick={() => setAba(id)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-gold',
              aba === id ? 'border-gold text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'chaves' ? <ChavesApi /> : <ApiDocs opcoes={opcoes} />}
    </div>
  )
}

/** Aplicações externas autorizadas a criar oportunidades (uma chave por aplicação). */
function ChavesApi() {
  const { data, isPending, error } = useApiClientes()
  const criar = useCriarApiCliente()
  const revogar = useRevogarApiCliente()
  const [nome, setNome] = useState('')
  const [erroForm, setErroForm] = useState<string | null>(null)
  const [novaChave, setNovaChave] = useState<{ nome: string; chave: string } | null>(null)

  const adicionar = () => {
    const n = nome.trim().toLowerCase()
    if (!NOME_OK.test(n)) return setErroForm('Use de 3 a 40 caracteres: letras minúsculas, números, - e _')
    setErroForm(null)
    criar.mutate(n, {
      onSuccess: (r) => {
        setNovaChave({ nome: r.cliente.nome, chave: r.chave })
        setNome('')
      },
      onError: (e) => setErroForm(mensagemErro(e)),
    })
  }

  const copiar = async (chave: string) => {
    try {
      await navigator.clipboard.writeText(chave)
      toast.success('Chave copiada.')
    } catch {
      toast.error('Não foi possível copiar: selecione e copie a chave manualmente.')
    }
  }

  return (
    <div>
      <h2 className="font-serif text-lg font-semibold text-ink">API para outras aplicações</h2>
      <p className="mt-0.5 max-w-[75ch] text-xs text-muted">
        Cada aplicação externa recebe uma <strong>chave</strong> para criar oportunidades no Radar como se fosse um cadastro manual (mesmos campos e regras; o e-mail e o Planner
        saem igual). A autoria aparece como <code>api:nome-da-aplicação</code>. A chave é mostrada <strong>uma única vez</strong>: guarde-a em local seguro. Documentação:{' '}
        <code>docs/API-EXTERNA.md</code>.
      </p>

      {novaChave && (
        <div role="status" className="mt-4 rounded-[10px] border border-gold/50 bg-surface p-4">
          <p className="text-[13px] font-semibold text-ink">Chave da aplicação “{novaChave.nome}” (não será mostrada de novo)</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md bg-line-soft px-2 py-1 text-[12.5px] text-ink">{novaChave.chave}</code>
            <Button type="button" onClick={() => copiar(novaChave.chave)}>
              <Copy className="size-4" aria-hidden /> Copiar
            </Button>
            <Button type="button" onClick={() => setNovaChave(null)}>
              Já guardei
            </Button>
          </div>
        </div>
      )}

      <form
        noValidate
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          adicionar()
        }}
      >
        <label className="min-w-64 text-xs font-semibold text-ink-soft">
          Nome da aplicação
          <input className={cn(campo, 'mt-1 block w-full')} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: sistema-contratos" maxLength={40} autoComplete="off" />
        </label>
        <Button type="submit" disabled={criar.isPending}>
          <Plus className="size-4" aria-hidden /> Criar chave
        </Button>
      </form>
      {erroForm && (
        <p role="alert" className="mt-2 text-xs text-st-critical">
          {erroForm}
        </p>
      )}

      <h3 className="mt-6 text-xs font-semibold text-ink-soft">Aplicações autorizadas</h3>
      {isPending ? (
        <p className="mt-2 text-[13px] text-muted">Carregando…</p>
      ) : error || !data ? (
        <p role="alert" className="mt-2 text-[13px] text-ink-soft">
          Não foi possível carregar as aplicações.
        </p>
      ) : data.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">Nenhuma aplicação cadastrada.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-[10px] border border-line bg-surface">
          {data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-[13px]">
              <KeyRound className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="font-semibold text-ink">{c.nome}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[11px]', c.ativo ? 'bg-line-soft text-ink' : 'bg-line-soft text-muted')}>{c.ativo ? 'ativa' : 'revogada'}</span>
              <span className="text-xs text-muted">
                criada por {c.criado_por} em {dataHoraBr(c.criado_em)} · último uso: {c.ultimo_uso_em ? dataHoraBr(c.ultimo_uso_em) : 'nunca'}
              </span>
              {c.ativo && (
                <Button
                  type="button"
                  className="ml-auto"
                  disabled={revogar.isPending}
                  onClick={() => {
                    if (window.confirm(`Revogar a chave de “${c.nome}”? A aplicação deixa de conseguir criar oportunidades.`)) {
                      revogar.mutate(c.id, { onSuccess: () => toast.success('Chave revogada.'), onError: (e) => toast.error(mensagemErro(e)) })
                    }
                  }}
                >
                  Revogar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
