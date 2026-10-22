/**
 * Consulta de CNPJ (dados abertos da Receita Federal), feita no servidor: a tela nunca chama serviços externos
 * (a Content-Security-Policy continua restrita a 'self'). Tenta VÁRIAS fontes públicas em sequência, porque
 * cada uma pode limitar ou bloquear consultas vindas de servidores em nuvem; o motivo de cada falha volta em `detalhe`.
 */
import { soDigitos, validaCnpj } from '../../src/domain/cnpj.ts'

export type EmpresaReceita = {
  cnpj: string
  razao_social: string
  tipo: 'Matriz' | 'Filial'
  situacao: string | null
  fonte: string
}

export type ResultadoCnpj =
  | { ok: true; empresa: EmpresaReceita }
  | { ok: false; motivo: 'invalido' | 'nao_encontrado' | 'indisponivel'; mensagem: string; detalhe?: string[] }

type Dados = { razao: string; filial: boolean; situacao: string | null }
type Fonte = { nome: string; url: (cnpj: string) => string; ler: (json: Record<string, unknown>) => Dados | null }

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** BrasilAPI e minhareceita.org devolvem o mesmo formato. */
const formatoBrasilApi = (d: Record<string, unknown>): Dados | null => {
  const razao = texto(d.razao_social)
  if (!razao) return null
  return {
    razao,
    filial: d.identificador_matriz_filial === 2 || /filial/i.test(texto(d.descricao_identificador_matriz_filial)),
    situacao: texto(d.descricao_situacao_cadastral) || null,
  }
}

export const FONTES: Fonte[] = [
  { nome: 'brasilapi', url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, ler: formatoBrasilApi },
  { nome: 'minhareceita', url: (c) => `https://minhareceita.org/${c}`, ler: formatoBrasilApi },
  {
    nome: 'cnpj.ws',
    url: (c) => `https://publica.cnpj.ws/cnpj/${c}`,
    ler: (d) => {
      const razao = texto(d.razao_social)
      const est = (d.estabelecimento ?? {}) as Record<string, unknown>
      if (!razao) return null
      return { razao, filial: /filial/i.test(texto(est.tipo)), situacao: texto(est.situacao_cadastral) || null }
    },
  },
  {
    nome: 'receitaws',
    url: (c) => `https://receitaws.com.br/v1/cnpj/${c}`,
    ler: (d) => {
      const razao = texto(d.nome)
      if (!razao || d.status === 'ERROR') return null
      return { razao, filial: /filial/i.test(texto(d.tipo)), situacao: texto(d.situacao) || null }
    },
  },
]

export async function consultaCnpj(entrada: string, buscar: typeof fetch = fetch, timeoutMs = 5000, fontes: Fonte[] = FONTES): Promise<ResultadoCnpj> {
  const cnpj = soDigitos(entrada)
  if (!validaCnpj(cnpj)) return { ok: false, motivo: 'invalido', mensagem: 'CNPJ inválido (confira os dígitos).' }

  const detalhe: string[] = []
  let naoEncontrado = 0
  for (const f of fontes) {
    try {
      const res = await buscar(f.url(cnpj), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json', 'user-agent': 'radar-prevendas/1.0 (+https://radar-prevendas.pages.dev)' },
      })
      if (res.status === 404) {
        naoEncontrado++
        detalhe.push(`${f.nome}: 404`)
        if (naoEncontrado >= 2) break // duas fontes concordam que não existe
        continue
      }
      if (!res.ok) {
        detalhe.push(`${f.nome}: HTTP ${res.status}`)
        continue
      }
      const d = f.ler((await res.json()) as Record<string, unknown>)
      if (!d) {
        detalhe.push(`${f.nome}: resposta sem razão social`)
        continue
      }
      return { ok: true, empresa: { cnpj, razao_social: d.razao, tipo: d.filial ? 'Filial' : 'Matriz', situacao: d.situacao, fonte: f.nome } }
    } catch (e) {
      detalhe.push(`${f.nome}: ${e instanceof Error ? e.name : 'erro'}`)
    }
  }
  if (naoEncontrado >= 2) return { ok: false, motivo: 'nao_encontrado', mensagem: 'CNPJ não encontrado na Receita Federal.', detalhe }
  return { ok: false, motivo: 'indisponivel', mensagem: 'Consulta à Receita indisponível no momento.', detalhe }
}
