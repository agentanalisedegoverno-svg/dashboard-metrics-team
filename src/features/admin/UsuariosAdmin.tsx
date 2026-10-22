import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSalvarUsuario, type Perfil, type UsuarioAdmin } from '../oportunidades/api'

const PERFIS: { valor: Perfil; rotulo: string; descricao: string }[] = [
  { valor: 'administrador', rotulo: 'Administrador', descricao: 'Tudo: cadastra, edita, arquiva e gerencia listas e perfis' },
  { valor: 'editor', rotulo: 'Editor', descricao: 'Cadastra e edita (não arquiva nem administra)' },
  { valor: 'visualizador', rotulo: 'Visualizador', descricao: 'Somente consulta' },
]

const perfilDe = (u: UsuarioAdmin): Perfil => (u.admin ? 'administrador' : u.somente_leitura ? 'visualizador' : 'editor')
const flagsDe = (p: Perfil) => ({ admin: p === 'administrador', somente_leitura: p === 'visualizador' })

const campo = 'rounded-lg border border-line bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-60'

export function UsuariosAdmin({ usuarios, meuEmail }: { usuarios: UsuarioAdmin[]; meuEmail: string }) {
  const salvar = useSalvarUsuario()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'' | Perfil>('')
  const [novo, setNovo] = useState(false)
  // Menor privilégio por padrão: quem entra começa como visualizador; dar mais acesso é um passo explícito.
  const [form, setForm] = useState({ nome: '', email: '', perfil: 'visualizador' as Perfil, pre_vendas: false })

  const erro = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')
  const aplica = (u: UsuarioAdmin, mudancas: Partial<UsuarioAdmin>, aviso: string) =>
    salvar.mutate({ ...u, ...mudancas }, { onSuccess: () => toast.success(aviso), onError: erro })

  const contagem = useMemo(() => {
    const c: Record<Perfil, number> = { administrador: 0, editor: 0, visualizador: 0 }
    for (const u of usuarios) if (u.ativo) c[perfilDe(u)]++
    return c
  }, [usuarios])

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return usuarios.filter((u) => (!filtro || perfilDe(u) === filtro) && (!q || `${u.nome} ${u.email ?? ''}`.toLowerCase().includes(q)))
  }, [usuarios, busca, filtro])

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold text-ink">Usuários e perfis</h2>
          <p className="mt-0.5 max-w-[70ch] text-xs text-muted">
            Só administradores criam ou removem pessoas dos grupos. Quem <strong>não está nesta lista</strong> entra como <strong>Editor</strong>, como sempre foi.
            Para tirar alguém de um grupo, mude o perfil dela.
          </p>
        </div>
        <Button type="button" onClick={() => setNovo((v) => !v)} aria-expanded={novo}>
          <Plus className="size-4" /> Adicionar usuário
        </Button>
      </div>

      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-live="polite">
        <span><strong>{contagem.administrador}</strong> administrador(es)</span>
        <span><strong>{contagem.editor}</strong> editor(es) listados</span>
        <span><strong>{contagem.visualizador}</strong> visualizador(es)</span>
      </p>

      {novo && (
        <form
          className="mt-3 grid gap-3 rounded-[10px] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.nome.trim()) return
            salvar.mutate(
              { nome: form.nome.trim(), email: form.email.trim() || null, pre_vendas: form.pre_vendas, ativo: true, ...flagsDe(form.perfil) },
              {
                onSuccess: () => {
                  toast.success('Usuário salvo.')
                  setForm({ nome: '', email: '', perfil: 'visualizador', pre_vendas: false })
                  setNovo(false)
                },
                onError: erro,
              },
            )
          }}
        >
          <label className="text-xs font-semibold text-ink-soft">
            Nome
            <input className={cn(campo, 'mt-1 w-full')} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} maxLength={120} required />
          </label>
          <label className="text-xs font-semibold text-ink-soft">
            E-mail
            <input className={cn(campo, 'mt-1 w-full')} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nome@ctctech.com.br" />
          </label>
          <label className="text-xs font-semibold text-ink-soft">
            Perfil
            <select aria-label="Perfil do novo usuário" className={cn(campo, 'mt-1 w-full')} value={form.perfil} onChange={(e) => setForm({ ...form, perfil: e.target.value as Perfil })}>
              {PERFIS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
          </label>
          <label className="flex items-end gap-1.5 pb-2 text-xs text-ink-soft">
            <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={form.pre_vendas} onChange={(e) => setForm({ ...form, pre_vendas: e.target.checked })} />
            Pré-vendas
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={salvar.isPending}>Salvar</Button>
            <Button type="button" onClick={() => setNovo(false)}>Cancelar</Button>
          </div>
          <p className="text-xs text-muted sm:col-span-2 lg:col-span-5">
            {PERFIS.find((p) => p.valor === form.perfil)?.descricao}. O e-mail é obrigatório para Visualizador e para atribuir cartões no Planner.
          </p>
        </form>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <input type="search" aria-label="Buscar usuário" placeholder="Buscar nome ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} className={cn(campo, 'min-w-60 flex-1')} />
        <select aria-label="Filtrar por perfil" className={campo} value={filtro} onChange={(e) => setFiltro(e.target.value as '' | Perfil)}>
          <option value="">Todos os perfis</option>
          {PERFIS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
        </select>
      </div>

      <div className="mt-3 overflow-x-auto rounded-[10px] border border-line bg-surface">
        <table className="w-full min-w-170 border-collapse text-[13px]">
          <caption className="sr-only">Usuários, e-mails e perfis de acesso</caption>
          <thead className="bg-surface-2 text-xs text-ink-soft">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Nome</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">E-mail</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Perfil</th>
              <th scope="col" className="px-3 py-2 text-center font-semibold">Pré-vendas</th>
              <th scope="col" className="px-3 py-2 text-center font-semibold">Ativo</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((u) => {
              const eu = u.email?.toLowerCase() === meuEmail.toLowerCase()
              const dica = eu ? 'Você não pode alterar o próprio perfil nem se desativar: peça a outro administrador.' : undefined
              return (
                <tr key={u.nome} className="border-t border-line-soft">
                  <td className={cn('px-3 py-2', !u.ativo && 'text-muted line-through')}>
                    {u.nome} {eu && <span className="ml-1 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-semibold">você</span>}
                  </td>
                  <td className="px-3 py-2">
                    {u.email ? (
                      u.email
                    ) : (
                      <input
                        aria-label={`Adicionar e-mail de ${u.nome}`}
                        type="email"
                        placeholder="sem e-mail — adicionar"
                        className={cn(campo, 'w-full')}
                        onBlur={(e) => e.target.value.trim() && aplica(u, { email: e.target.value.trim().toLowerCase() }, 'E-mail salvo.')}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Perfil de ${u.nome}`}
                      title={dica}
                      className={campo}
                      value={perfilDe(u)}
                      disabled={eu || salvar.isPending}
                      onChange={(e) => {
                        const p = e.target.value as Perfil
                        aplica(u, flagsDe(p), `${u.nome}: perfil alterado para ${PERFIS.find((x) => x.valor === p)?.rotulo}.`)
                      }}
                    >
                      {PERFIS.map((p) => (
                        <option key={p.valor} value={p.valor} disabled={p.valor === 'visualizador' && !u.email}>
                          {p.rotulo}{p.valor === 'visualizador' && !u.email ? ' (exige e-mail)' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" aria-label={`${u.nome} é pré-vendas`} className="size-4 accent-[var(--gold)]" checked={u.pre_vendas} disabled={salvar.isPending}
                      onChange={(e) => aplica(u, { pre_vendas: e.target.checked }, `${u.nome}: pré-vendas ${e.target.checked ? 'ativado' : 'desativado'}.`)} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" aria-label={`${u.nome} está ativo`} title={dica} className="size-4 accent-[var(--gold)]" checked={u.ativo} disabled={eu || salvar.isPending}
                      onChange={(e) => aplica(u, { ativo: e.target.checked }, `${u.nome}: ${e.target.checked ? 'ativado' : 'desativado'}.`)} />
                  </td>
                </tr>
              )
            })}
            {linhas.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Nenhum usuário com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
