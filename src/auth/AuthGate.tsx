import { useEffect, useState, type ReactNode } from 'react'
import type { AccountInfo } from '@azure/msal-browser'
import { Button } from '@/components/ui/button'
import { isAuthEnabled, restoreSession, signIn, signOut } from './auth'

/** Exige login Microsoft antes de montar o painel (quando configurado). */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'out'; error?: string } | { status: 'in'; account: AccountInfo | null }>(
    isAuthEnabled ? { status: 'loading' } : { status: 'in', account: null },
  )

  useEffect(() => {
    if (!isAuthEnabled) return
    restoreSession()
      .then((account) => setState(account ? { status: 'in', account } : { status: 'out' }))
      .catch((e: unknown) => setState({ status: 'out', error: e instanceof Error ? e.message : 'Falha no login.' }))
  }, [])

  if (state.status === 'loading') return <p role="status" className="p-8 text-center text-[13px] text-muted">Verificando sessão…</p>

  if (state.status === 'out') {
    return (
      <main className="mx-auto mt-24 max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-card">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.12em] text-gold">CTC · Pré-Vendas</div>
        <h1 className="text-2xl text-brand-ink">Radar Pré-Vendas</h1>
        <p className="mt-3 text-[14px] text-ink-soft">Uso interno. Entre com a sua conta Microsoft da empresa para ver o painel.</p>
        {state.error && <p role="alert" className="mt-3 text-[12.5px] text-st-critical">{state.error}</p>}
        <Button type="button" className="mt-5" onClick={() => void signIn()}>Entrar com Microsoft</Button>
      </main>
    )
  }

  return (
    <>
      {isAuthEnabled && (
        <div className="mx-auto flex max-w-295 justify-end gap-3 px-5 pt-3 text-[12px] text-muted max-sm:px-4">
          <span>{state.account?.username}</span>
          <button type="button" className="cursor-pointer font-semibold text-gold underline" onClick={() => void signOut()}>Sair</button>
        </div>
      )}
      {children}
    </>
  )
}
