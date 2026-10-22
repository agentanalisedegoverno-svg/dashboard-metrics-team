import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ErroCampo, Oportunidade, OportunidadeInput } from '@/domain/oportunidade'

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly erros: ErroCampo[] = [],
    readonly atual?: Oportunidade,
  ) {
    super(message)
  }
}

/** Chamada à API de cadastro. A sessão vai no cookie do Cloudflare Access; escritas levam o cabeçalho anti-CSRF. */
async function chamar<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: init.signal,
    headers: {
      accept: 'application/json',
      ...(method !== 'GET' ? { 'x-radar-csrf': '1', 'content-type': 'application/json' } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const corpo = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    throw new ApiError(
      typeof corpo?.error === 'string' ? corpo.error : `Falha na API (HTTP ${res.status})`,
      res.status,
      Array.isArray(corpo?.erros) ? (corpo.erros as ErroCampo[]) : [],
      corpo?.atual as Oportunidade | undefined,
    )
  }
  return corpo as T
}

export type Me = { email: string; nome: string | null; admin: boolean; preVendas: boolean }
export type Opcao = { valor: string; ativo: boolean; ordem: number }
export type UsuarioAdmin = { nome: string; email: string | null; admin: boolean; pre_vendas: boolean; ativo: boolean }
export type Opcoes = { listas: Record<string, Opcao[]>; preVendas: string[]; linhasTorre: Record<string, string>; usuarios?: UsuarioAdmin[] }
export type EmpresaReceita = { cnpj: string; razao_social: string; tipo: 'Matriz' | 'Filial'; situacao: string | null; fonte?: string }
export type Historico = { id: number; versao: number; acao: string; por: string; em: string; alteracoes: Record<string, [unknown, unknown]> }
export type Salvo = Oportunidade & { avisos?: { regra: string; ids: number[] }[] }

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: ({ signal }) => chamar<Me>('/me', { signal }), staleTime: 5 * 60_000, retry: false })

/** Consulta o CNPJ na Receita (pela API do Radar). */
export const useConsultaCnpj = () => useMutation({ mutationFn: (cnpj: string) => chamar<EmpresaReceita>(`/cnpj/${cnpj}`) })

export const useOpcoes = () =>
  useQuery({ queryKey: ['opcoes'], queryFn: ({ signal }) => chamar<Opcoes>('/opcoes', { signal }), staleTime: 60_000, retry: false })

export const useOportunidades = (arquivadas: boolean) =>
  useQuery({
    queryKey: ['oportunidades', { arquivadas }],
    queryFn: ({ signal }) => chamar<{ rows: Oportunidade[] }>(`/oportunidades${arquivadas ? '?arquivadas=1' : ''}`, { signal }).then((r) => r.rows),
    staleTime: 30_000,
    retry: false,
  })

export const useHistorico = (id: number | null) =>
  useQuery({
    queryKey: ['historico', id],
    queryFn: ({ signal }) => chamar<{ itens: Historico[] }>(`/oportunidades/${id}/historico`, { signal }).then((r) => r.itens),
    enabled: id !== null,
    retry: false,
  })

/** Depois de qualquer escrita, a grade e as métricas do painel precisam refletir o banco. */
function useInvalidar() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['oportunidades'] }), qc.invalidateQueries({ queryKey: ['dataset'] }), qc.invalidateQueries({ queryKey: ['historico'] }), qc.invalidateQueries({ queryKey: ['opcoes'] })])
}

export const useCriar = () => {
  const invalidar = useInvalidar()
  return useMutation({ mutationFn: (d: OportunidadeInput) => chamar<Salvo>('/oportunidades', { method: 'POST', body: d }), onSuccess: invalidar })
}

export const useAtualizar = () => {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: ({ id, versao, dados }: { id: number; versao: number; dados: OportunidadeInput }) =>
      chamar<Salvo>(`/oportunidades/${id}`, { method: 'PUT', body: { ...dados, versao } }),
    onSuccess: invalidar,
  })
}

export const useArquivar = () => {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: ({ id, restaurar }: { id: number; restaurar: boolean }) =>
      chamar<Oportunidade>(`/oportunidades/${id}/${restaurar ? 'restaurar' : 'arquivar'}`, { method: 'POST' }),
    onSuccess: invalidar,
  })
}

export const useSalvarOpcao = () => {
  const invalidar = useInvalidar()
  return useMutation({ mutationFn: (o: { lista: string; valor: string; ativo: boolean; ordem: number }) => chamar('/opcoes', { method: 'PUT', body: o }), onSuccess: invalidar })
}

export const useSalvarUsuario = () => {
  const invalidar = useInvalidar()
  return useMutation({ mutationFn: (u: UsuarioAdmin) => chamar('/usuarios', { method: 'PUT', body: u }), onSuccess: invalidar })
}
