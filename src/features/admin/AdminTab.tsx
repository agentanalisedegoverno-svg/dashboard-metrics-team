import { KeyRound, ListChecks, Mail, Map, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useMe, useOpcoes } from '../oportunidades/api'
import { ApiAdmin } from './ApiAdmin'
import { EmailsAdmin } from './EmailsAdmin'
import { LinhasTorre } from './LinhasTorre'
import { ListasAdmin } from './ListasAdmin'
import { UsuariosAdmin } from './UsuariosAdmin'

const SECOES = [
  { id: 'usuarios', rotulo: 'Usuários e perfis', Icone: Users },
  { id: 'listas', rotulo: 'Listas de opções', Icone: ListChecks },
  { id: 'linhas', rotulo: 'Linha → Torre', Icone: Map },
  { id: 'emails', rotulo: 'E-mails', Icone: Mail },
  { id: 'api', rotulo: 'API', Icone: KeyRound },
] as const
type SecaoId = (typeof SECOES)[number]['id']

/** Seção inicial vinda do endereço (#admin/listas), para poder compartilhar o link. */
const secaoDoEndereco = (): SecaoId => {
  const m = /^#admin\/(\w+)/.exec(window.location.hash)
  return (SECOES.find((s) => s.id === m?.[1])?.id ?? 'usuarios') as SecaoId
}

/** Área de administração (só administradores): navegação própria, em página inteira (não em janela). */
export default function AdminTab() {
  const me = useMe()
  const opcoes = useOpcoes()
  const [secao, setSecao] = useState<SecaoId>(secaoDoEndereco)

  useEffect(() => {
    window.history.replaceState(null, '', `#admin/${secao}`)
  }, [secao])

  if (me.isPending || opcoes.isPending) return <p className="mt-6 text-[13px] text-muted">Carregando administração…</p>
  if (me.error || opcoes.error || !me.data || !opcoes.data) {
    return <div role="alert" className="mt-6 rounded-[10px] border border-st-critical/40 bg-surface p-4 text-[13px] text-ink-soft">Não foi possível carregar a administração.</div>
  }
  if (!me.data.admin) {
    return <div role="alert" className="mt-6 rounded-[10px] border border-line bg-surface p-4 text-[13px] text-ink-soft">Somente administradores acessam esta área.</div>
  }

  return (
    <section className="mt-5 grid gap-6 md:grid-cols-[220px_1fr]" aria-label="Administração">
      <nav aria-label="Seções da administração" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {SECOES.map(({ id, rotulo, Icone }) => (
          <button
            key={id}
            type="button"
            aria-current={secao === id ? 'page' : undefined}
            onClick={() => setSecao(id)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-gold',
              secao === id ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-line-soft hover:text-ink',
            )}
          >
            <Icone className="size-4 shrink-0" aria-hidden />
            {rotulo}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {secao === 'usuarios' && <UsuariosAdmin usuarios={opcoes.data.usuarios ?? []} meuEmail={me.data.email} />}
        {secao === 'listas' && <ListasAdmin opcoes={opcoes.data} />}
        {secao === 'linhas' && <LinhasTorre opcoes={opcoes.data} />}
        {secao === 'emails' && <EmailsAdmin opcoes={opcoes.data} />}
        {secao === 'api' && <ApiAdmin opcoes={opcoes.data} />}
      </div>
    </section>
  )
}
