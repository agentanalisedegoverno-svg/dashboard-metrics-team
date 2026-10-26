import type { OportunidadeInput } from '@/domain/oportunidade'

export type Nome = keyof OportunidadeInput
export type Tipo = 'texto' | 'longo' | 'data' | 'hora' | 'dinheiro' | 'percentual' | 'inteiro' | 'lista' | 'preVendas' | 'bool' | 'cnpj'

export type Campo = {
  nome: Nome
  rotulo: string
  tipo: Tipo
  obrigatorio?: boolean
  /** Só aparece para esses status (ou se já tiver valor). */
  quando?: readonly string[]
  largo?: boolean
  dica?: string
  /** Valor calculado por outro campo (não editável quando o campo de origem está preenchido). */
  calculado?: boolean
  /** Percentual: casas decimais mostradas no formulário e aplicadas ao salvar (padrão: as que o usuário digitar). */
  casas?: number
  /** Campo de preenchimento destacado em amarelo no formulário. */
  destaque?: boolean
}

export type Secao = { id: string; titulo: string; campos: Campo[] }

/** As 34 colunas da planilha, agrupadas na ordem em que o time preenche. */
export const SECOES: Secao[] = [
  {
    id: 'identificacao',
    titulo: 'Identificação',
    campos: [
      { nome: 'status', destaque: true, rotulo: 'Status', tipo: 'lista', obrigatorio: true },
      { nome: 'orgao', destaque: true, rotulo: 'Instituição / Órgão', tipo: 'texto', obrigatorio: true, largo: true },
      { nome: 'descritivo', destaque: true, rotulo: 'Descritivo', tipo: 'longo', obrigatorio: true, largo: true, dica: 'Até 50 caracteres (resumo curto); o detalhe vai em Objeto' },
      { nome: 'objeto', destaque: true, rotulo: 'Objeto', tipo: 'longo', largo: true, dica: 'O que está sendo contratado. Não existe na planilha: fica em branco nos registros importados' },
      { nome: 'processo', destaque: true, rotulo: 'Processo/Pregão', tipo: 'texto' },
      { nome: 'uasg', destaque: true, rotulo: 'UASG', tipo: 'texto' },
      { nome: 'uf', destaque: true, rotulo: 'UF', tipo: 'lista' },
    ],
  },
  {
    id: 'edital',
    titulo: 'Edital e disputa',
    campos: [
      { nome: 'data_distribuicao', destaque: true, rotulo: 'Data de distribuição (envio do edital)', tipo: 'data' },
      { nome: 'data_pregao_dt', destaque: true, rotulo: 'Data do pregão', tipo: 'data', obrigatorio: true },
      { nome: 'hora_pregao', destaque: true, rotulo: 'Hora do pregão', tipo: 'hora', dica: 'Opcional, horário de Brasília. A planilha só tem a data' },
      { nome: 'criterio', destaque: true, rotulo: 'Critério', tipo: 'lista' },
      { nome: 'modalidade', destaque: true, rotulo: 'Modalidade', tipo: 'lista' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'texto' },
      { nome: 'modo_disputa', destaque: true, rotulo: 'Modo de disputa', tipo: 'lista' },
      { nome: 'origem_oportunidade', destaque: true, rotulo: 'Origem', tipo: 'lista' },
      { nome: 'site', destaque: true, rotulo: 'Site', tipo: 'lista' },
      { nome: 'vistoria', destaque: true, rotulo: 'Vistoria', tipo: 'lista' },
    ],
  },
  {
    id: 'escopo',
    titulo: 'Escopo e responsável',
    campos: [
      { nome: 'linha_servico', destaque: true, rotulo: 'Linha de serviço', tipo: 'lista' },
      { nome: 'torre', rotulo: 'Torre', tipo: 'lista', obrigatorio: true, calculado: true, dica: 'Preenchida automaticamente pela linha de serviço' },
      { nome: 'unidade_fornecimento', destaque: true, rotulo: 'Unidade de fornecimento', tipo: 'lista' },
      { nome: 'conta_vinculada', destaque: true, rotulo: 'Conta vinculada', tipo: 'lista' },
      { nome: 'analista', rotulo: 'Pré-vendas', tipo: 'preVendas', largo: true, dica: 'Marque um ou mais pré-vendas' },
    ],
  },
  {
    id: 'valores',
    titulo: 'Valores e margens',
    campos: [
      { nome: 'orcamento', destaque: true, rotulo: 'Orçamento (R$)', tipo: 'dinheiro' },
      { nome: 'orcamento_sigiloso', destaque: true, rotulo: 'Orçamento sigiloso', tipo: 'bool', dica: 'Marque quando o órgão não divulga o valor' },
      { nome: 'valor_ctc', rotulo: 'Valor CTC (R$)', tipo: 'dinheiro' },
      { nome: 'custo_total_ctc', rotulo: 'Custo total CTC (R$)', tipo: 'dinheiro' },
      { nome: 'mc_ctc', rotulo: 'MC CTC (%)', tipo: 'percentual' },
      { nome: 'simulacao_mc_arrematante', rotulo: 'Simulação da MC × arrematante (%)', tipo: 'percentual' },
      { nome: 'impostos', rotulo: 'Impostos (%)', tipo: 'percentual', casas: 2, dica: 'Percentual com duas casas decimais (ex.: 8,65)' },
    ],
  },
  {
    id: 'resultado',
    titulo: 'Resultado do certame',
    campos: [
      { nome: 'valor_vencedor', rotulo: 'Valor vencedor (R$)', tipo: 'dinheiro' },
      { nome: 'empresa_vencedora_cnpj', rotulo: 'Empresa vencedora (CNPJ)', tipo: 'cnpj', largo: true, dica: 'Informe só o CNPJ: a razão social e se é matriz ou filial vêm da Receita Federal' },
      { nome: 'posicao_lance', rotulo: 'Posição pós-lance CTC', tipo: 'inteiro' },
      { nome: 'situacao_lance', rotulo: 'Situação do lance', tipo: 'lista', dica: 'Use quando não há posição (ex.: Desclassificada)' },
      { nome: 'motivo_lost', rotulo: 'Motivo do Lost', tipo: 'lista', quando: ['Lost'] },
      { nome: 'motivo_no_go', rotulo: 'Motivo do No Go', tipo: 'lista', quando: ['No Go'] },
      { nome: 'detalhe_no_go', rotulo: 'Detalhe do No Go', tipo: 'longo', largo: true, quando: ['No Go'] },
    ],
  },
  {
    id: 'obs',
    titulo: 'Acompanhamento',
    campos: [{ nome: 'observacoes', rotulo: 'Acompanhamento / status / observações', tipo: 'longo', largo: true }],
  },
]

export const TODOS_CAMPOS = SECOES.flatMap((s) => s.campos)
export const TIPO_CAMPO: Record<string, Tipo> = Object.fromEntries(TODOS_CAMPOS.map((c) => [c.nome, c.tipo]))
export const ROTULO: Record<string, string> = Object.fromEntries(TODOS_CAMPOS.map((c) => [c.nome, c.rotulo]))
