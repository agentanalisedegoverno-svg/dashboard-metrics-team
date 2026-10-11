import { useQuery } from '@tanstack/react-query'
import { getAccessToken } from '@/auth/auth'
import { DatasetSchema, type Row } from '@/domain/types'

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
const DATA_URL = import.meta.env.VITE_DATA_URL || '/data.json'
const REQUEST_TIMEOUT_MS = 5_000
// O fallback estático é sintético: só vale em desenvolvimento ou quando a
// publicação o habilita de forma explícita (demonstração). Em produção real,
// API fora do ar deve virar erro visível, nunca números falsos.
const ALLOW_MOCK_FALLBACK = import.meta.env.DEV || import.meta.env.VITE_ALLOW_MOCK_FALLBACK === 'true'

export type Dataset = { rows: Row[]; updatedAt: string | null; isMock: boolean }

export type SyncStatus = {
  lastSyncAt: string | null
  rowCount: number
  error: string | null
  isMock: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function requestJson(path: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const abortRequest = () => controller.abort(signal.reason)
  if (signal.aborted) abortRequest()
  else signal.addEventListener('abort', abortRequest, { once: true })
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const token = await getAccessToken()
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: token ? { ...init?.headers, authorization: `Bearer ${token}` } : init?.headers,
      signal: controller.signal,
      cache: 'no-cache',
    })
    if (!res.ok) throw new Error(`Falha na API (HTTP ${res.status})`)
    return await res.json()
  } finally {
    window.clearTimeout(timeoutId)
    signal.removeEventListener('abort', abortRequest)
  }
}

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
function parseDataset(json: unknown, lastModified: string | null = null, isMockFallback = false): Dataset {
  const rawRows = Array.isArray(json) ? json : isRecord(json) ? json.rows : undefined
  const updatedAt = isRecord(json) && typeof json.updatedAt === 'string' ? json.updatedAt : null
  const isMock = isRecord(json) && typeof json.isMock === 'boolean' ? json.isMock : isMockFallback
  const parsed = DatasetSchema.safeParse(rawRows)
  if (!parsed.success) throw new Error('Formato de dados inesperado (schema inválido).')
  return { rows: parsed.data, updatedAt: updatedAt ?? formatHttpDate(lastModified), isMock }
}

async function fetchDataset(signal: AbortSignal): Promise<Dataset> {
  let apiError: unknown

  try {
    return parseDataset(await requestJson('/rows', signal))
  } catch (error) {
    if (signal.aborted) throw error
    apiError = error
  }

  if (!ALLOW_MOCK_FALLBACK) {
    throw new Error(`API indisponível. ${apiError instanceof Error ? apiError.message : 'erro desconhecido'}`)
  }

  try {
    const res = await fetch(DATA_URL, { signal, cache: 'no-cache' })
    if (!res.ok) throw new Error(`Falha ao carregar fallback (HTTP ${res.status})`)
    return parseDataset(await res.json(), res.headers.get('last-modified'), true)
  } catch (fallbackError) {
    if (signal.aborted) throw fallbackError
    const apiMessage = apiError instanceof Error ? apiError.message : 'erro desconhecido'
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'erro desconhecido'
    throw new Error(`API e fallback indisponíveis. API: ${apiMessage}. Fallback: ${fallbackMessage}`)
  }
}

export async function fetchSyncStatus(signal: AbortSignal): Promise<SyncStatus | null> {
  let value: unknown
  try {
    value = await requestJson('/status', signal)
  } catch (error) {
    if (
      !signal.aborted &&
      (error instanceof TypeError || (error instanceof Error && /HTTP (404|502|503|504)/.test(error.message)))
    ) return null
    throw error
  }
  if (
    !isRecord(value) ||
    (typeof value.lastSyncAt !== 'string' && value.lastSyncAt !== null) ||
    typeof value.rowCount !== 'number' ||
    !Number.isInteger(value.rowCount) ||
    value.rowCount < 0 ||
    typeof value.isMock !== 'boolean' ||
    (typeof value.error !== 'string' && value.error !== null)
  ) {
    throw new Error('Resposta de status da API inválida.')
  }
  return {
    lastSyncAt: value.lastSyncAt,
    rowCount: value.rowCount,
    error: value.error,
    isMock: value.isMock,
  }
}

export async function triggerSync(signal: AbortSignal): Promise<void> {
  await requestJson('/sync', signal, { method: 'POST' })
}

export const useDataset = () =>
  useQuery({
    queryKey: ['dataset'],
    queryFn: ({ signal }) => fetchDataset(signal),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  })

export const useSyncStatus = () =>
  useQuery({
    queryKey: ['syncStatus'],
    queryFn: ({ signal }) => fetchSyncStatus(signal),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  })
