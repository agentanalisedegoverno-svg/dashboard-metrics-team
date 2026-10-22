import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSalvarOpcao, useSalvarUsuario, type Opcoes } from './api'

const ROTULO_LISTA: Record<string, string> = {
  status: 'Status', torre: 'Torre', linha_servico: 'Linha de serviço', criterio: 'Critério', uf: 'UF', modalidade: 'Modalidade',
  modo_disputa: 'Modo de disputa', origem_oportunidade: 'Origem', site: 'Site', vistoria: 'Vistoria', conta_vinculada: 'Conta vinculada',
  motivo_no_go: 'Motivo do No Go', motivo_lost: 'Motivo do Lost', situacao_lance: 'Situação do lance', unidade_fornecimento: 'Unidade de fornecimento',
}

const inputCls = 'rounded-lg border border-line bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40'

export function AdminListas({ aberto, onFechar, opcoes }: { aberto: boolean; onFechar: () => void; opcoes: Opcoes }) {
  const [aba, setAba] = useState<'listas' | 'usuarios'>('listas')
  const [lista, setLista] = useState('status')
  const [novo, setNovo] = useState('')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const salvarOpcao = useSalvarOpcao()
  const salvarUsuario = useSalvarUsuario()
  const itens = opcoes.listas[lista] ?? []

  const erro = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-170">
        <div className="border-b border-line px-5 py-4">
          <DialogTitle className="font-serif text-lg font-semibold text-ink">Listas e usuários</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-muted">
            Itens desativados deixam de aparecer no cadastro, mas continuam válidos nos registros que já os usam.
          </DialogDescription>
          <div role="tablist" aria-label="Administração" className="mt-3 flex gap-1">
            {(['listas', 'usuarios'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={aba === t} onClick={() => setAba(t)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-[13px] font-semibold ${aba === t ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}>
                {t === 'listas' ? 'Listas' : 'Usuários'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {aba === 'listas' ? (
            <>
              <label className="mb-1 block text-xs font-semibold text-ink-soft" htmlFor="adm-lista">Lista</label>
              <select id="adm-lista" className={`${inputCls} w-full`} value={lista} onChange={(e) => setLista(e.target.value)}>
                {Object.entries(ROTULO_LISTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <ul className="mt-3 divide-y divide-line-soft rounded-lg border border-line">
                {itens.map((o) => (
                  <li key={o.valor} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                    <span className={o.ativo ? 'text-ink' : 'text-muted line-through'}>{o.valor}</span>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                      <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={o.ativo} disabled={salvarOpcao.isPending}
                        onChange={(e) => salvarOpcao.mutate({ lista, valor: o.valor, ativo: e.target.checked, ordem: o.ordem }, { onError: erro })} />
                      Ativo
                    </label>
                  </li>
                ))}
                {itens.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">Lista vazia.</li>}
              </ul>
              <form className="mt-3 flex gap-2" onSubmit={(e) => {
                e.preventDefault()
                if (!novo.trim()) return
                salvarOpcao.mutate({ lista, valor: novo.trim(), ativo: true, ordem: itens.length + 1 }, { onSuccess: () => { setNovo(''); toast.success('Item adicionado.') }, onError: erro })
              }}>
                <input className={`${inputCls} flex-1`} aria-label="Novo item da lista" placeholder="Novo item" value={novo} onChange={(e) => setNovo(e.target.value)} maxLength={120} />
                <Button type="submit" disabled={salvarOpcao.isPending}>Adicionar</Button>
              </form>
            </>
          ) : (
            <>
              <ul className="divide-y divide-line-soft rounded-lg border border-line">
                {(opcoes.usuarios ?? []).map((u) => (
                  <li key={u.nome} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                    <span>
                      <span className={u.ativo ? 'font-semibold text-ink' : 'text-muted line-through'}>{u.nome}</span>
                      <span className="ml-2 text-xs text-muted">{u.email ?? 'sem e-mail (só consta como pré-vendas)'}</span>
                    </span>
                    <span className="flex gap-3 text-xs text-ink-soft">
                      {(['pre_vendas', 'admin', 'ativo'] as const).map((k) => (
                        <label key={k} className="flex cursor-pointer items-center gap-1">
                          <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={u[k]} disabled={salvarUsuario.isPending}
                            onChange={(e) => salvarUsuario.mutate({ ...u, [k]: e.target.checked }, { onError: erro })} />
                          {k === 'pre_vendas' ? 'Pré-vendas' : k === 'admin' ? 'Admin' : 'Ativo'}
                        </label>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => {
                e.preventDefault()
                if (!nome.trim()) return
                salvarUsuario.mutate({ nome: nome.trim(), email: email.trim() || null, admin: false, pre_vendas: true, ativo: true }, { onSuccess: () => { setNome(''); setEmail(''); toast.success('Usuário salvo.') }, onError: erro })
              }}>
                <input className={inputCls} aria-label="Nome" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                <input className={inputCls} aria-label="E-mail (opcional)" placeholder="E-mail (opcional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Button type="submit" disabled={salvarUsuario.isPending}>Adicionar</Button>
              </form>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
