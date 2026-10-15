/**
 * Conversão da aba "Base Governo" (34 colunas) para o modelo do cadastro web.
 * Função pura: normaliza grafias, separa números de texto, gera a chave estável da linha
 * e produz um relatório de qualidade (nada é corrigido às escondidas: divergências viram avisos).
 */
import { parseDate, parseMoney, type Cell } from './rows'

export type SyncRow = {
  chave_planilha: string
  data_distribuicao: string | null
  data_pregao_dt: string | null
  status: string | null
  orgao: string | null
  descritivo: string | null
  criterio: string | null
  uf: string | null
  processo: string | null
  uasg: string | null
  modalidade: string | null
  tipo: string | null
  modo_disputa: string | null
  origem_oportunidade: string | null
  analista: string | null
  site: string | null
  vistoria: string | null
  linha_servico: string | null
  torre: string | null
  unidade_fornecimento: string | null
  conta_vinculada: string | null
  mc_ctc: number | null
  simulacao_mc_arrematante: number | null
  orcamento: number | null
  orcamento_sigiloso: boolean
  valor_vencedor: number | null
  valor_ctc: number | null
  custo_total_ctc: number | null
  motivo_no_go: string | null
  detalhe_no_go: string | null
  empresas_vencedoras: string | null
  motivo_lost: string | null
  observacoes: string | null
  posicao_lance: number | null
  situacao_lance: string | null
  pendencias: string[]
}

export type Aviso = { linha: number; regra: string }
export type Resultado = { rows: SyncRow[]; avisos: Aviso[]; resumo: Record<string, number> }

export const fold = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Texto curto: sem NBSP, espaços colapsados e aparado. Vazio vira null. */
const curto = (v: Cell): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}
/** Texto longo: preserva quebras de linha. */
const longo = (v: Cell): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
  return s === '' ? null : s
}

const COLUNAS: Record<string, string> = {
  'data de distribuicao(envio edital)': 'data_distribuicao',
  status: 'status',
  'data pregao': 'data_pregao',
  'instituicao / orgao': 'orgao',
  descritivo: 'descritivo',
  criterio: 'criterio',
  uf: 'uf',
  processo: 'processo',
  uasg: 'uasg',
  modalidade: 'modalidade',
  tipo: 'tipo',
  'modo de disputa': 'modo_disputa',
  origem: 'origem_oportunidade',
  'pre-vendas': 'analista',
  site: 'site',
  vistoria: 'vistoria',
  'linha de servico': 'linha_servico',
  torre: 'torre',
  'unidade de fornecimento': 'unidade_fornecimento',
  'conta vinculada': 'conta_vinculada',
  'mc ctc': 'mc_ctc',
  'simulacao da mc x arrematante': 'simulacao_mc',
  'simulacao da mc x versao': 'simulacao_mc',
  orcamento: 'orcamento',
  'valor vencedor': 'valor_vencedor',
  'valor ctc': 'valor_ctc',
  'custo total ctc': 'custo_total_ctc',
  'motivo de no go': 'motivo_no_go',
  'detalhe do no go': 'detalhe_no_go',
  'empresas vencedoras': 'empresas_vencedoras',
  'motivo do lost': 'motivo_lost',
  'acompanhamento / status / observacoes': 'observacoes',
  'posicao pos lance ctc': 'posicao_lance',
}

/** Correções explícitas de grafia (valor dobrado -> forma canônica). */
const CANON: Record<string, Record<string, string>> = {
  criterio: { 'tecnica e preco': 'Técnica e preço', 'menor preco': 'Menor Preço' },
  modalidade: { chamamento: 'Chamamento Público', concorrencia: 'Concorrência' },
  modo_disputa: { 'aberto e fechado': 'Aberto e Fechado', 'aberto/fechado': 'Aberto e Fechado', 'dispensa com disputa': 'Dispensa com disputa' },
  conta_vinculada: { sim: 'Sim', nao: 'Não' },
  motivo_no_go: {
    'dificuldades em operacao': 'Dificuldades em Operações',
    'risco juridico': 'Risco Jurídico',
    'valor estimado baixo': 'Valor estimado baixo',
    'valor abaixo de 1m': 'Valor estimado baixo',
    'time tecnico': 'Habilitação técnica - Time técnico',
    'no go – habilitacao – certificacao': 'Habilitação técnica - Certificação',
    'no go - habilitacao - certificacao': 'Habilitação técnica - Certificação',
  },
}

/** Escolhe, entre grafias que só diferem em caixa/acento/espaço, a mais frequente. */
function porFrequencia(valores: (string | null)[]): Map<string, string> {
  const grupos = new Map<string, Map<string, number>>()
  for (const v of valores) {
    if (!v) continue
    const k = fold(v)
    const g = grupos.get(k) ?? new Map<string, number>()
    g.set(v, (g.get(v) ?? 0) + 1)
    grupos.set(k, g)
  }
  const canon = new Map<string, string>()
  for (const [k, g] of grupos) canon.set(k, [...g.entries()].sort((a, b) => b[1] - a[1])[0][0])
  return canon
}

const iso = (d: { y: number; m: number; d: number } | null) =>
  d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null

const PLACEHOLDER = 'validar'

export function mapPlanilha(values: readonly (readonly Cell[])[]): Resultado {
  if (values.length < 2) return { rows: [], avisos: [], resumo: {} }
  const idx = new Map<string, number>()
  values[0].forEach((h, i) => {
    const campo = COLUNAS[fold(h)]
    if (campo && !idx.has(campo)) idx.set(campo, i)
  })
  for (const obrigatoria of ['status', 'data_pregao', 'orgao']) {
    if (!idx.has(obrigatoria)) throw new Error(`Cabeçalho inesperado: coluna obrigatória ausente (${obrigatoria}).`)
  }
  const get = (r: readonly Cell[], c: string): Cell => {
    const i = idx.get(c)
    return i === undefined ? null : r[i]
  }
  const dados = values.slice(1).map((r, n) => ({ r, linha: n + 2 })).filter(({ r }) => r.some((c) => curto(c) !== null))

  // Canonização por frequência (sites, linhas de serviço, motivos): só varia caixa/acento/espaço.
  const freq: Record<string, Map<string, string>> = {}
  for (const c of ['site', 'linha_servico', 'motivo_lost', 'modalidade']) freq[c] = porFrequencia(dados.map(({ r }) => curto(get(r, c))))
  const nogoPre = dados.map(({ r }) => curto(get(r, 'motivo_no_go')))
  freq.motivo_no_go = porFrequencia(nogoPre)

  const avisos: Aviso[] = []
  const resumo: Record<string, number> = {}
  const conta = (k: string) => (resumo[k] = (resumo[k] ?? 0) + 1)
  const rows: SyncRow[] = []
  const vistos = new Map<string, number>()

  for (const { r, linha } of dados) {
    const pend: string[] = []
    const lista = (campo: keyof typeof CANON | string, bruto: Cell): string | null => {
      let v = curto(bruto)
      if (v === null) return null
      if (fold(v) === PLACEHOLDER) {
        pend.push(String(campo))
        conta(`pendencia:${campo}`)
        return null
      }
      const manual = CANON[campo as string]?.[fold(v)]
      if (manual) v = manual
      else if (freq[campo as string]) v = freq[campo as string].get(fold(v)) ?? v
      return v
    }

    const status = curto(get(r, 'status'))
    if (status && fold(status) === PLACEHOLDER) {
      pend.push('status')
      conta('pendencia:status')
    }

    // UF
    let uf = curto(get(r, 'uf'))
    if (uf && fold(uf) === PLACEHOLDER) { pend.push('uf'); conta('pendencia:uf'); uf = null }

    // Orçamento: "Sigiloso" vira marcação; texto monetário é convertido
    const orcBruto = get(r, 'orcamento')
    const sigiloso = typeof orcBruto === 'string' && fold(orcBruto) === 'sigiloso'
    if (sigiloso) conta('orcamento_sigiloso')
    const orcamento = sigiloso ? null : parseMoney(orcBruto)
    const vvBruto = get(r, 'valor_vencedor')
    if (typeof vvBruto === 'string' && parseMoney(vvBruto) !== null) conta('valor_vencedor_texto_convertido')

    // Margens: valores acima de 1 estavam em pontos percentuais
    const pct = (v: Cell): number | null => {
      const n = parseMoney(v)
      if (n === null) return null
      if (Math.abs(n) > 1) { conta('margem_convertida_de_percentual'); return Math.round((n / 100) * 10000) / 10000 }
      return n
    }

    // Posição pós lance: número, "19ª posição" ou situação
    let posicao: number | null = null
    let situacao: string | null = null
    const pb = get(r, 'posicao_lance')
    if (typeof pb === 'number') posicao = Math.trunc(pb) >= 1 ? Math.trunc(pb) : null
    else if (typeof pb === 'string') {
      const f = fold(pb)
      const m = /(\d+)/.exec(f)
      if (f.includes('desclassificad')) situacao = 'Desclassificada'
      else if (f.includes('nao participamos')) situacao = 'Não participamos'
      else if (m && +m[1] >= 1) posicao = +m[1]
      else if (f) { pend.push('posicao_lance'); conta('pendencia:posicao_lance') }
    }

    // Motivo de NO GO: texto longo vira detalhe e o motivo passa a "Outros"
    let motivoNoGo = lista('motivo_no_go', get(r, 'motivo_no_go'))
    let detalhe = longo(get(r, 'detalhe_no_go'))
    if (motivoNoGo && (motivoNoGo.length > 60 || /\n/.test(String(get(r, 'motivo_no_go'))))) {
      const original = longo(get(r, 'motivo_no_go'))!
      detalhe = detalhe ? `${original}\n${detalhe}` : original
      motivoNoGo = 'Outros'
      conta('motivo_no_go_longo_movido_para_detalhe')
    }

    const processoBruto = get(r, 'processo')
    const processo = processoBruto === null ? null : curto(String(processoBruto))
    const uasgBruta = curto(get(r, 'uasg'))
    const uasg = uasgBruta && uasgBruta !== '-' ? uasgBruta : null

    const dPregao = parseDate(get(r, 'data_pregao'))
    const dDist = parseDate(get(r, 'data_distribuicao'))
    const orgao = curto(get(r, 'orgao'))
    const torre = curto(get(r, 'torre'))

    const base = [fold(processo), fold(orgao), iso(dPregao) ?? '', fold(torre)].join('|')
    const n = (vistos.get(base) ?? 0) + 1
    vistos.set(base, n)
    if (n > 1) { avisos.push({ linha, regra: 'possivel_duplicata' }); conta('possivel_duplicata') }

    const row: SyncRow = {
      chave_planilha: n === 1 ? base : `${base}#${n}`,
      data_distribuicao: iso(dDist),
      data_pregao_dt: iso(dPregao),
      status,
      orgao,
      descritivo: curto(get(r, 'descritivo')),
      criterio: lista('criterio', get(r, 'criterio')),
      uf,
      processo,
      uasg,
      modalidade: lista('modalidade', get(r, 'modalidade')),
      tipo: curto(get(r, 'tipo')),
      modo_disputa: lista('modo_disputa', get(r, 'modo_disputa')),
      origem_oportunidade: curto(get(r, 'origem_oportunidade')),
      analista: curto(get(r, 'analista')),
      site: lista('site', (curto(get(r, 'site')) ?? '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')') || null),
      vistoria: curto(get(r, 'vistoria')),
      linha_servico: lista('linha_servico', get(r, 'linha_servico')),
      torre,
      unidade_fornecimento: curto(get(r, 'unidade_fornecimento')),
      conta_vinculada: lista('conta_vinculada', get(r, 'conta_vinculada')),
      mc_ctc: pct(get(r, 'mc_ctc')),
      simulacao_mc_arrematante: pct(get(r, 'simulacao_mc')),
      orcamento,
      orcamento_sigiloso: sigiloso,
      valor_vencedor: parseMoney(vvBruto),
      valor_ctc: parseMoney(get(r, 'valor_ctc')),
      custo_total_ctc: parseMoney(get(r, 'custo_total_ctc')),
      motivo_no_go: motivoNoGo,
      detalhe_no_go: detalhe,
      empresas_vencedoras: longo(get(r, 'empresas_vencedoras')),
      motivo_lost: lista('motivo_lost', get(r, 'motivo_lost')),
      observacoes: longo(get(r, 'observacoes')),
      posicao_lance: posicao,
      situacao_lance: situacao,
      pendencias: pend,
    }

    // Relatório de qualidade (regras que o cadastro web passa a impor)
    const av = (regra: string) => { avisos.push({ linha, regra }); conta(`aviso:${regra}`) }
    if (!row.status) av('status_vazio')
    if (!row.data_pregao_dt) av('data_pregao_vazia')
    if (row.data_distribuicao && row.data_pregao_dt && row.data_pregao_dt < row.data_distribuicao) av('pregao_antes_da_distribuicao')
    if (row.status === 'Lost' && !row.motivo_lost) av('lost_sem_motivo')
    if (row.status === 'No Go' && !row.motivo_no_go) av('no_go_sem_motivo')
    if (row.motivo_lost && row.status !== 'Lost') av('motivo_lost_com_status_diferente')
    if (row.motivo_no_go && row.status !== 'No Go') av('motivo_no_go_com_status_diferente')
    if (row.status === 'Win' && row.valor_ctc === null) av('win_sem_valor_ctc')
    if (row.orcamento && row.valor_vencedor && row.valor_vencedor > row.orcamento) av('valor_vencedor_maior_que_orcamento')
    if (row.orcamento && row.valor_ctc && row.valor_ctc > row.orcamento) av('valor_ctc_maior_que_orcamento')
    if (!row.analista) av('sem_pre_vendas')
    rows.push(row)
  }
  return { rows, avisos, resumo }
}
