import { useQuery } from '@tanstack/react-query'
import { getAccessToken } from '@/auth/auth'
import { DatasetSchema, type Row } from '@/domain/types'
import { ErroApi, falhaDeExcecao, falhaDeResposta, registrarFalha } from './erroApi'

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

async function requestJson(path: string, signal: AbortSignal, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const abortRequest = () => controller.abort(signal.reason)
  if (signal.aborted) abortRequest()
  else signal.addEventListener('abort', abortRequest, { once: true })
  let estourou = false
  const timeoutId = window.setTimeout(() => {
    estourou = true
    controller.abort()
  }, timeoutMs)
  const inicio = performance.now()

  try {
    const token = await getAccessToken()
    let res: Response
    try {
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: token ? { ...init?.headers, authorization: `Bearer ${token}` } : init?.headers,
        signal: controller.signal,
        cache: 'no-cache',
      })
    } catch (e) {
      if (!signal.aborted) registrarFalha(falhaDeExcecao(path, inicio, estourou)) // guarda a pista e repassa o erro original
      throw e
    }
    if (!res.ok) {
      const falha = await falhaDeResposta(res, path, inicio)
      registrarFalha(falha)
      throw new ErroApi(falha)
    }
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
  // A API devolve ISO (UTC); o cabeçalho mostra o horário de Brasília legível.
  return { rows: parsed.data, updatedAt: (updatedAt ? formatHttpDate(updatedAt) ?? updatedAt : null) ?? formatHttpDate(lastModified), isMock }
}

/**
 * O servidor guarda /api/rows por ~20 s (ver functions/_lib/cachePainel.ts). Depois de uma gravação a próxima leitura precisa vir
 * do banco, senão quem acabou de salvar veria o dado antigo: `?fresco=1` pula a cópia guardada e a substitui para todos.
 */
let proximaLeituraFresca = false
export const marcarDadosDesatualizados = () => {
  proximaLeituraFresca = true
}

async function fetchDataset(signal: AbortSignal): Promise<Dataset> {
  let apiError: unknown

  try {
    const fresca = proximaLeituraFresca
    proximaLeituraFresca = false
    return parseDataset(await requestJson(fresca ? '/rows?fresco=1' : '/rows', signal))
  } catch (error) {
    if (signal.aborted) throw error
    apiError = error
  }

  if (!ALLOW_MOCK_FALLBACK) {
    throw new Error(`API indisponível. ${apiError instanceof Error ? apiError.message : 'erro desconhecido'}`, { cause: apiError })
  }

  try {
    const res = await fetch(DATA_URL, { signal, cache: 'no-cache' })
    if (!res.ok) throw new Error(`Falha ao carregar fallback (HTTP ${res.status})`)
    return parseDataset(await res.json(), res.headers.get('last-modified'), true)
  } catch (fallbackError) {
    if (signal.aborted) throw fallbackError
    const apiMessage = apiError instanceof Error ? apiError.message : 'erro desconhecido'
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'erro desconhecido'
    throw new Error(`API e fallback indisponíveis. API: ${apiMessage}. Fallback: ${fallbackMessage}`, { cause: fallbackError })
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

/** Diagnóstico feito no servidor (config, bancos e a consulta do painel, com tempos). Mais tempo que as demais chamadas: roda consultas. */
export const buscarDiagnostico = (signal: AbortSignal) => requestJson('/diagnostico', signal, undefined, 25_000)

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
    // O status só muda a cada carga da planilha: não precisa de consulta a cada 30 s por aba (o servidor também guarda por 60 s).
    // Em aba escondida o react-query já não consulta (refetchIntervalInBackground é falso por padrão).
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  })
