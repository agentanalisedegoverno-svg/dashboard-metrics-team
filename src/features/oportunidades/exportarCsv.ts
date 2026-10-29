import type { Oportunidade } from '@/domain/oportunidade'
import { TODOS_CAMPOS, type Campo } from './campos'

/**
 * CSV das oportunidades que estão na tela (já com os filtros aplicados), para abrir direto no Excel em português:
 * separador `;`, UTF-8 com BOM (acentos), vírgula decimal, datas dd/mm/aaaa e quebra de linha CRLF.
 * Valores de texto que começam com `=`, `+`, `-`, `@`, tab ou retorno ganham um apóstrofo na frente: o Excel não executa fórmula
 * vinda de um campo digitado (formulário ou API externa).
 */
const SEP = ';'
const BOM = '\uFEFF'

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const numero = (n: number, casas?: number) => (casas === undefined ? String(n) : n.toFixed(casas)).replace('.', ',')
const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/** Neutraliza fórmula: texto que o Excel interpretaria como comando vira texto comum. */
export const textoSeguro = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

/** Aspas e separadores: o valor entre aspas quando precisa, com as aspas internas duplicadas. */
export const celula = (s: string) => (/[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

function valor(c: Campo, v: unknown): string {
  if (c.tipo === 'bool') return v === true ? 'Sim' : 'Não'
  if (vazio(v)) return ''
  switch (c.tipo) {
    case 'data': return dataBr(String(v))
    case 'hora': return String(v).slice(0, 5)
    case 'dinheiro': return numero(Number(v), 2)
    case 'percentual': return numero(Math.round(Number(v) * 10000) / 100)
    case 'inteiro': return numero(Number(v))
    case 'cnpj': return /^\d{14}$/.test(String(v)) ? String(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : textoSeguro(String(v)) // com máscara: o Excel não vira notação científica
    default: return textoSeguro(String(v).replace(/\s*\r?\n\s*/g, ' ').trim())
  }
}

type Coluna = { titulo: string; de: (o: Oportunidade) => string }
const bruto = (o: Oportunidade, nome: string) => (o as unknown as Record<string, unknown>)[nome]

/** Colunas: código, todos os campos do formulário (nos rótulos e na ordem dele) e os dados de controle. */
export const COLUNAS: Coluna[] = [
  { titulo: 'Código', de: (o) => textoSeguro(o.codigo ?? '') },
  ...TODOS_CAMPOS.map((c): Coluna => ({ titulo: c.rotulo, de: (o) => (c.nome === 'orcamento' && o.orcamento_sigiloso ? 'Sigiloso' : valor(c, bruto(o, c.nome))) })),
  { titulo: 'Empresa vencedora (razão social)', de: (o) => textoSeguro(o.empresa_vencedora_razao ?? '') },
  { titulo: 'Empresa vencedora (matriz/filial)', de: (o) => textoSeguro(o.empresa_vencedora_tipo ?? '') },
  { titulo: 'Pendências', de: (o) => (o.pendencias ?? []).join(', ') },
  { titulo: 'Cadastrada por', de: (o) => textoSeguro(o.criado_por ?? '') },
  { titulo: 'Solicitante (via API)', de: (o) => textoSeguro(String(bruto(o, 'solicitante') ?? '')) },
  { titulo: 'Atualizada por', de: (o) => textoSeguro(o.atualizado_por ?? '') },
  { titulo: 'Atualizada em', de: (o) => (o.atualizado_em ? dataBr(o.atualizado_em) : '') },
  { titulo: 'Arquivada', de: (o) => (bruto(o, 'arquivado_em') ? 'Sim' : 'Não') },
]

export function csvDeOportunidades(dados: Oportunidade[]): string {
  const linhas = [COLUNAS.map((c) => celula(c.titulo)).join(SEP), ...dados.map((o) => COLUNAS.map((c) => celula(c.de(o))).join(SEP))]
  return BOM + linhas.join('\r\n') + '\r\n'
}

/** Dia de hoje (aaaa-mm-dd) em Brasília, para o nome do arquivo. */
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

export const nomeArquivoCsv = () => `oportunidades-${hoje()}.csv`

/** Baixa o CSV no navegador (sem passar pelo servidor: é o que o usuário já está vendo). */
export function baixarCsv(dados: Oportunidade[]) {
  const blob = new Blob([csvDeOportunidades(dados)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivoCsv()
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
