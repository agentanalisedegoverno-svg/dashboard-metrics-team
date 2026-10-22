import { Suspense, lazy, useDeferredValue, useMemo, useState } from 'react'
import { Toaster } from 'sonner'
import { DrillDialog } from '@/components/DrillDialog'
import { FilterBar } from '@/components/FilterBar'
import { Header } from '@/components/Header'
import { SyncStatus } from '@/components/SyncStatus'
import { EmptyNote } from '@/components/Primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDataset } from '@/data/useRows'
import { useMe } from '@/features/oportunidades/api'
import { passesFilters } from '@/domain/filters'
import { computeMetrics } from '@/domain/metrics'
import { useFilters } from '@/store/filters'
import { ExecTab } from '@/features/exec/ExecTab'
import { InterTab } from '@/features/inter/InterTab'
import { OpsTab } from '@/features/ops/OpsTab'

// Abas estáticas e raramente abertas ficam fora do bundle inicial.
const MetaTab = lazy(() => import('@/features/meta/MetaTab'))
const PlanoTab = lazy(() => import('@/features/plano/PlanoTab'))
const OportunidadesTab = lazy(() => import('@/features/oportunidades/OportunidadesTab'))
const AdminTab = lazy(() => import('@/features/admin/AdminTab'))

const TABS = [
  ['exec', 'Visão Executiva'],
  ['inter', 'Intersetorial & Portfólio'],
  ['ops', 'Operacional'],
  ['meta', 'Metodologia & Maturidade'],
  ['plano', 'Plano de Ação'],
  ['oportunidades', 'Oportunidades'],
] as const

export default function App() {
  const { data, isPending, error, refetch } = useDataset()
  const me = useMe()
  const ehAdmin = Boolean(me.data?.admin)
  // O endereço #admin/... abre direto a administração (para administradores).
  const [aba, setAba] = useState<string>(() => (window.location.hash.startsWith('#admin') ? 'admin' : 'exec'))
  const abas = ehAdmin ? [...TABS, ['admin', 'Administração'] as const] : TABS
  const abaAtiva = aba === 'admin' && !ehAdmin && !me.isPending ? 'exec' : aba
  const filters = useFilters((s) => s.filters)
  // Mantém checkboxes/popovers responsivos enquanto as métricas recalculam.
  const deferred = useDeferredValue(filters)
  const allRows = data?.rows
  const rows = useMemo(() => (allRows ? allRows.filter((r) => passesFilters(r, deferred)) : []), [allRows, deferred])
  const m = useMemo(() => computeMetrics(rows), [rows])
  const noYear = deferred.ano.size === 0

  return (
    <div className={`mx-auto px-5 ${abaAtiva === 'oportunidades' || abaAtiva === 'admin' ? 'max-w-[1700px]' : 'max-w-295'} pb-14 pt-7 max-sm:px-4 max-sm:pb-10 max-sm:pt-5`}>
      <Header total={m.total} all={allRows?.length ?? 0} updatedAt={data?.updatedAt ?? null} noYear={noYear} />
      <SyncStatus />

      {error ? (
        <div role="alert" className="mt-6 rounded-[10px] border border-st-critical/40 bg-surface p-4 text-[13px] text-ink-soft">
          Não foi possível carregar os dados. {error.message}{' '}
          <button className="cursor-pointer font-semibold text-gold underline" onClick={() => refetch()}>Tentar novamente</button>
        </div>
      ) : isPending || !allRows ? (
        <div className="mt-6"><EmptyNote>Carregando dados…</EmptyNote></div>
      ) : (
        <>
          {abaAtiva !== 'oportunidades' && abaAtiva !== 'admin' && <FilterBar rows={allRows} filters={filters} matched={m.total} />}
          <Tabs value={abaAtiva} onValueChange={setAba}>
            <TabsList aria-label="Seções do painel">
              {abas.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}
            </TabsList>
            <TabsContent value="exec"><ExecTab m={m} rows={rows} noYear={noYear} /></TabsContent>
            <TabsContent value="inter"><InterTab m={m} rows={rows} noYear={noYear} /></TabsContent>
            <TabsContent value="ops"><OpsTab m={m} rows={rows} noYear={noYear} /></TabsContent>
            <TabsContent value="meta"><Suspense fallback={<EmptyNote>Carregando…</EmptyNote>}><MetaTab allRows={allRows} /></Suspense></TabsContent>
            <TabsContent value="plano"><Suspense fallback={<EmptyNote>Carregando…</EmptyNote>}><PlanoTab /></Suspense></TabsContent>
            {ehAdmin && <TabsContent value="admin"><Suspense fallback={<EmptyNote>Carregando…</EmptyNote>}><AdminTab /></Suspense></TabsContent>}
            <TabsContent value="oportunidades"><Suspense fallback={<EmptyNote>Carregando…</EmptyNote>}><OportunidadesTab /></Suspense></TabsContent>
          </Tabs>
        </>
      )}

      <footer className="mt-11 flex flex-wrap justify-between gap-2 border-t border-line pt-4.5 text-xs text-muted">
        <span>
          {data?.isMock
            ? 'Demonstração local: dados sintéticos — sem conexão com SharePoint'
            : 'Fonte: BaseLicitacao (aba "Base Governo") · SharePoint GOVERNO2 · CTC Pré-Vendas — somente leitura'}
        </span>
        <span>Radar Pré-Vendas — uso interno do time</span>
      </footer>
      <DrillDialog />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  )
}
