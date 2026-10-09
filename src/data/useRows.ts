import { useQuery } from '@tanstack/react-query'
import { DatasetSchema, type Row } from '@/domain/types'

const DATA_URL = import.meta.env.VITE_DATA_URL || '/data.json'

export type Dataset = { rows: Row[]; updatedAt: string | null }

/** Last-Modified (HTTP) -> 'dd/mm/aaaa hh:mm (Brasília)'. */
function formatHttpDate(v: string | null): string | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} (Brasília)`
}

/**
 * Leitura somente-leitura do dataset já calculado. Aceita `[...]` ou
 * `{ rows: [...], updatedAt }`. Nunca escreve na planilha original.
 */
async function fetchDataset(signal: AbortSignal): Promise<Dataset> {
  const res = await fetch(DATA_URL, { signal, cache: 'no-cache' })
  if (!res.ok) throw new Error(`Falha ao carregar dados (HTTP ${res.status})`)
  const json: unknown = await res.json()
  const rawRows = Array.isArray(json) ? json : (json as { rows?: unknown }).rows
  const updatedAt = Array.isArray(json) ? null : ((json as { updatedAt?: string }).updatedAt ?? null)
  const parsed = DatasetSchema.safeParse(rawRows)
  if (!parsed.success) throw new Error('Formato de dados inesperado (schema inválido).')
  return { rows: parsed.data, updatedAt: updatedAt ?? formatHttpDate(res.headers.get('last-modified')) }
}

export const useDataset = () =>
  useQuery({
    queryKey: ['dataset'],
    queryFn: ({ signal }) => fetchDataset(signal),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  })
