/**
 * Converte a matriz `usedRange.values` do Microsoft Graph (aba "Base Governo")
 * no contrato de linhas do painel. Função pura: sem rede, testável.
 */
export type ApiRow = {
  ano: string | null
  mes: string | null
  status: string | null
  uf: string | null
  torre: string | null
  linhaServico: string | null
  vistoria: string | null
  analista: string | null
  motivoNoGo: string | null
  motivoLost: string | null
  contaVinculada: string | null
  orcamento: number | null
  valorCtc: number | null
  valorVencedor: number | null
  sla: number | null
  processo: string | null
  orgao: string | null
  descritivo: string | null
  dataPregao: string | null
  acaoIA: unknown
}

export type Cell = string | number | boolean | null | undefined

const norm = (h: Cell) =>
  String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Cabeçalho normalizado (sem acento/caixa) -> campo do painel. */
const COLUMNS: Record<string, keyof ApiRow> = {
  status: 'status',
  uf: 'uf',
  torre: 'torre',
  'linha de servico': 'linhaServico',
  vistoria: 'vistoria',
  'pre-vendas': 'analista',
  'motivo de no go': 'motivoNoGo',
  'motivo do lost': 'motivoLost',
  'conta vinculada': 'contaVinculada',
  orcamento: 'orcamento',
  'valor ctc': 'valorCtc',
  'valor vencedor': 'valorVencedor',
  processo: 'processo',
  'instituicao / orgao': 'orgao',
  descritivo: 'descritivo',
  'data pregao': 'dataPregao',
  'acao ia': 'acaoIA',
}

const text = (v: Cell): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Aceita número, "R$ 1.234,56", "R$ 2,712,939.02" ou vazio. */
export function parseMoney(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const raw = text(v)
  if (!raw) return null
  let s = raw.replace(/[^\d.,-]/g, '')
  if (!s) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Serial do Excel (1900) ou texto d/m/aaaa|aaaa-mm-dd -> { y, m, d } ou null. */
export function parseDate(v: Cell): { y: number; m: number; d: number } | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const dt = new Date(Math.round((v - 25569) * 86400) * 1000)
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
  }
  const s = text(v)
  if (!s) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return { y: +m[1], m: +m[2], d: +m[3] }
  // O painel e a planilha em pt-BR usam dia/mês/ano.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m && +m[2] >= 1 && +m[2] <= 12) return { y: +m[3], m: +m[2], d: +m[1] }
  return null
}

export function mapRows(values: readonly (readonly Cell[])[]): ApiRow[] {
  if (values.length < 2) return []
  const index = new Map<keyof ApiRow, number>()
  values[0].forEach((h, i) => {
    const field = COLUMNS[norm(h)]
    if (field && !index.has(field)) index.set(field, i)
  })
  if (!index.has('status') || !index.has('dataPregao')) {
    throw new Error('Cabeçalho inesperado: colunas "Status" e "Data Pregão" são obrigatórias.')
  }
  const get = (row: readonly Cell[], f: keyof ApiRow) => {
    const i = index.get(f)
    return i === undefined ? undefined : row[i]
  }

  const out: ApiRow[] = []
  for (const row of values.slice(1)) {
    if (row.every((c) => text(c) === null)) continue
    const date = parseDate(get(row, 'dataPregao'))
    out.push({
      ano: date ? String(date.y) : null,
      mes: date ? `${date.y}-${pad(date.m)}` : null,
      status: text(get(row, 'status')),
      uf: text(get(row, 'uf')),
      torre: text(get(row, 'torre')),
      linhaServico: text(get(row, 'linhaServico')),
      vistoria: text(get(row, 'vistoria')),
      analista: text(get(row, 'analista')),
      motivoNoGo: text(get(row, 'motivoNoGo')),
      motivoLost: text(get(row, 'motivoLost')),
      contaVinculada: text(get(row, 'contaVinculada')),
      orcamento: parseMoney(get(row, 'orcamento')),
      valorCtc: parseMoney(get(row, 'valorCtc')),
      valorVencedor: parseMoney(get(row, 'valorVencedor')),
      sla: null,
      processo: text(get(row, 'processo')),
      orgao: text(get(row, 'orgao')),
      descritivo: text(get(row, 'descritivo')),
      dataPregao: date ? `${pad(date.d)}/${pad(date.m)}/${date.y}` : null,
      acaoIA: get(row, 'acaoIA') ?? null,
    })
  }
  return out
}
