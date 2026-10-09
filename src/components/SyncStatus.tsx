import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { triggerSync, useSyncStatus } from '@/data/useRows'
import { Button } from '@/components/ui/button'

function formatLastSync(value: string | null): string {
  if (!value) return 'Ainda não atualizado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function SyncStatus() {
  const queryClient = useQueryClient()
  const { data, error } = useSyncStatus()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  async function handleRefresh() {
    setIsRefreshing(true)
    setRefreshError(null)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000)

    try {
      await triggerSync(controller.signal)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dataset'] }),
        queryClient.invalidateQueries({ queryKey: ['syncStatus'] }),
      ])
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : 'Não foi possível atualizar os dados.')
    } finally {
      window.clearTimeout(timeoutId)
      setIsRefreshing(false)
    }
  }

  if (!data && !error) return null

  return (
    <section
      aria-label="Status da fonte de dados"
      aria-live="polite"
      className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3"
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${error || data?.error ? 'bg-st-critical' : 'bg-emerald-600'}`}
      />
      <div className="min-w-0 flex-1 text-[12px] text-ink-soft">
        {data ? (
          <>
            <div className="font-semibold text-ink">
              {data.rowCount.toLocaleString('pt-BR')} linhas
              {data.isMock && <span className="ml-2 text-gold">API de demonstração</span>}
            </div>
            <div>Última atualização: {formatLastSync(data.lastSyncAt)}</div>
            {data.error && <div className="text-st-critical">{data.error}</div>}
          </>
        ) : (
          <div className="text-st-critical">
            Não foi possível consultar o status da API: {error instanceof Error ? error.message : 'erro desconhecido'}
          </div>
        )}
        {refreshError && <div role="alert" className="text-st-critical">{refreshError}</div>}
      </div>
      <Button type="button" onClick={handleRefresh} disabled={isRefreshing}>
        {isRefreshing ? 'Atualizando…' : data?.isMock ? 'Atualizar mock' : 'Sincronizar'}
      </Button>
    </section>
  )
}
