/**
 * Anotações do cartão do Planner: TODAS as informações da oportunidade, na ordem e com os rótulos do formulário do Radar.
 * Função pura (sem rede). O orçamento sigiloso nunca mostra valor.
 */
import { SECOES, type Campo } from '../../src/features/oportunidades/campos.ts'

const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
const limpa = (v: unknown) => String(v).replace(/\r\n/g, '\n').trim()

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number) => `${(n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const cnpj = (s: string) => (/^\d{14}$/.test(s) ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s)

function valor(c: Campo, v: unknown, d: Record<string, unknown>): string {
  if (c.nome === 'orcamento' && d.orcamento_sigiloso === true) return 'Sigiloso'
  if (c.tipo === 'bool') return v === true ? 'Sim' : 'Não'
  if (vazio(v)) return '—'
  switch (c.tipo) {
    case 'data': return dataBr(String(v))
    case 'hora': return String(v).slice(0, 5)
    case 'dinheiro': return brl(Number(v))
    case 'percentual': return pct(Number(v))
    case 'cnpj': return cnpj(String(v))
    default: return limpa(v)
  }
}

/** `d` é a linha da oportunidade (colunas do banco). `versao` e `codigo` vêm dela. */
export function notaCompleta(d: Record<string, unknown>, chave: string): string {
  const linhas: string[] = [`Radar ${chave} (v${d.versao}) — dados da oportunidade`]
  for (const s of SECOES) {
    linhas.push('', s.titulo.toUpperCase())
    for (const c of s.campos) {
      if (c.quando && vazio(d[c.nome]) && !c.quando.includes(String(d.status))) continue // motivos só existem em No Go / Lost
      linhas.push(`${c.rotulo}: ${valor(c, d[c.nome], d)}`)
    }
    if (s.id === 'resultado') {
      linhas.push(`Empresa vencedora (razão social): ${vazio(d.empresa_vencedora_razao) ? '—' : limpa(d.empresa_vencedora_razao)}`)
      linhas.push(`Empresa vencedora (matriz/filial): ${vazio(d.empresa_vencedora_tipo) ? '—' : limpa(d.empresa_vencedora_tipo)}`)
    }
  }
  const pend = Array.isArray(d.pendencias) ? (d.pendencias as string[]) : []
  linhas.push('', `Pendências: ${pend.length ? pend.join(', ') : 'nenhuma'}`)
  if (!vazio(d.criado_por)) linhas.push(`Cadastrada por: ${limpa(d.criado_por)}`)
  return linhas.join('\n')
}
