/**
 * Consulta de CNPJ (dados abertos da Receita Federal) pela BrasilAPI, feita no servidor (a tela nunca chama a
 * API externa, e a Content-Security-Policy continua restrita a 'self').
 */
import { soDigitos, validaCnpj } from '../../src/domain/cnpj.ts'

export type EmpresaReceita = {
  cnpj: string
  razao_social: string
  tipo: 'Matriz' | 'Filial'
  situacao: string | null
}

export type ResultadoCnpj =
  | { ok: true; empresa: EmpresaReceita }
  | { ok: false; motivo: 'invalido' | 'nao_encontrado' | 'indisponivel'; mensagem: string }

const URL_BASE = 'https://brasilapi.com.br/api/cnpj/v1'

export async function consultaCnpj(entrada: string, buscar: typeof fetch = fetch, timeoutMs = 6000): Promise<ResultadoCnpj> {
  const cnpj = soDigitos(entrada)
  if (!validaCnpj(cnpj)) return { ok: false, motivo: 'invalido', mensagem: 'CNPJ inválido (confira os dígitos).' }
  try {
    const res = await buscar(`${URL_BASE}/${cnpj}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
    if (res.status === 404) return { ok: false, motivo: 'nao_encontrado', mensagem: 'CNPJ não encontrado na Receita Federal.' }
    if (!res.ok) return { ok: false, motivo: 'indisponivel', mensagem: 'Consulta à Receita indisponível no momento.' }
    const d = (await res.json()) as {
      razao_social?: string
      identificador_matriz_filial?: number
      descricao_identificador_matriz_filial?: string
      descricao_situacao_cadastral?: string
    }
    const razao = (d.razao_social ?? '').trim()
    if (!razao) return { ok: false, motivo: 'indisponivel', mensagem: 'A Receita não devolveu a razão social.' }
    const filial = d.identificador_matriz_filial === 2 || /filial/i.test(d.descricao_identificador_matriz_filial ?? '')
    return { ok: true, empresa: { cnpj, razao_social: razao, tipo: filial ? 'Filial' : 'Matriz', situacao: d.descricao_situacao_cadastral ?? null } }
  } catch {
    return { ok: false, motivo: 'indisponivel', mensagem: 'Consulta à Receita indisponível no momento.' }
  }
}
