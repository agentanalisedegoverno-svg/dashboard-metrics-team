import { useSyncStatus } from '@/data/useRows'

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
  const { data, error } = useSyncStatus()

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
      </div>
    </section>
  )
}
