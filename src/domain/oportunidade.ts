/**
 * Contrato do cadastro de oportunidades, compartilhado entre a API (Pages Functions) e o front.
 * Aqui só se garante FORMATO (tipos, tamanhos, vazio -> null). As regras de negócio (listas fechadas,
 * obrigatoriedade por status, datas) vivem no banco (`validar_oportunidade`), que é a fonte da verdade.
 */
import { z } from 'zod'
import { soDigitos, validaCnpj } from './cnpj.ts'

const vazioParaNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

const texto = (max: number) =>
  z.preprocess(vazioParaNull, z.string().max(max, `Máximo de ${max} caracteres`).nullable().optional()).transform((v) => v ?? null)

const numero = z
  .preprocess((v) => {
    const s = vazioParaNull(v)
    return typeof s === 'string' ? Number(s.replace(',', '.')) : s
  }, z.number({ error: 'Número inválido' }).finite('Número inválido').nullable().optional())
  .transform((v) => v ?? null)

/** CNPJ: aceita máscara, guarda só os 14 dígitos e valida os dígitos verificadores. */
const cnpj = z
  .preprocess((v) => (typeof v === 'string' ? soDigitos(v) || null : v), z.string().refine(validaCnpj, 'CNPJ inválido (confira os dígitos)').nullable().optional())
  .transform((v) => v ?? null)

const tipoEmpresa = z
  .preprocess(vazioParaNull, z.enum(['Matriz', 'Filial']).nullable().optional())
  .transform((v) => v ?? null)

const inteiro = z
  .preprocess((v) => {
    const s = vazioParaNull(v)
    return typeof s === 'string' ? Number(s) : s
  }, z.number({ error: 'Número inválido' }).int('Deve ser inteiro').nullable().optional())
  .transform((v) => v ?? null)

const data = z
  .preprocess(
    vazioParaNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato aaaa-mm-dd')
      .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), 'Data inválida')
      .nullable()
      .optional(),
  )
  .transform((v) => v ?? null)

export const oportunidadeInput = z.object({
  data_distribuicao: data,
  data_pregao_dt: data,
  status: texto(60),
  orgao: texto(200),
  descritivo: texto(100_000), // sem limite prático de caracteres
  criterio: texto(60),
  uf: texto(2),
  processo: texto(100),
  uasg: texto(60),
  modalidade: texto(80),
  tipo: texto(80),
  modo_disputa: texto(80),
  origem_oportunidade: texto(60),
  analista: texto(120),
  site: texto(120),
  vistoria: texto(60),
  linha_servico: texto(120),
  torre: texto(60),
  unidade_fornecimento: texto(200),
  conta_vinculada: texto(60),
  mc_ctc: numero,
  simulacao_mc_arrematante: numero,
  orcamento: numero,
  orcamento_sigiloso: z.boolean().optional().default(false),
  valor_vencedor: numero,
  valor_ctc: numero,
  custo_total_ctc: numero,
  motivo_no_go: texto(120),
  detalhe_no_go: texto(5000),
  empresas_vencedoras: texto(1000), // texto antigo (somente leitura na web)
  empresa_vencedora_cnpj: cnpj,
  empresa_vencedora_razao: texto(300),
  empresa_vencedora_tipo: tipoEmpresa,
  motivo_lost: texto(120),
  observacoes: texto(5000),
  posicao_lance: inteiro,
  situacao_lance: texto(60),
  pendencias: z.array(z.string().max(60)).max(40).optional().default([]),
})

export type OportunidadeInput = z.infer<typeof oportunidadeInput>

export const atualizacaoInput = z.object({ versao: z.number().int().min(1) }).and(oportunidadeInput)

export const opcaoInput = z.object({
  lista: z.string().min(1).max(60),
  valor: z.string().trim().min(1).max(120),
  ativo: z.boolean().default(true),
  ordem: z.number().int().min(0).max(10_000).default(0),
})

export const usuarioInput = z.object({
  nome: z.string().trim().min(1).max(120),
  email: z.preprocess(vazioParaNull, z.string().trim().toLowerCase().email().nullable().optional()).transform((v) => v ?? null),
  admin: z.boolean().default(false),
  pre_vendas: z.boolean().default(false),
  ativo: z.boolean().default(true),
})

export type ErroCampo = { campo: string; mensagem: string }

/** Converte os issues do Zod no mesmo formato de erro devolvido pelo banco. */
export function errosZod(error: z.ZodError): ErroCampo[] {
  return error.issues.map((i) => ({ campo: String(i.path[0] ?? 'corpo'), mensagem: i.message }))
}

/** Campo -> lista fechada administrada pelo admin (tabela `opcoes`). */
export const CAMPO_LISTA = {
  status: 'status',
  torre: 'torre',
  linha_servico: 'linha_servico',
  criterio: 'criterio',
  uf: 'uf',
  modalidade: 'modalidade',
  modo_disputa: 'modo_disputa',
  origem_oportunidade: 'origem_oportunidade',
  site: 'site',
  vistoria: 'vistoria',
  conta_vinculada: 'conta_vinculada',
  motivo_no_go: 'motivo_no_go',
  motivo_lost: 'motivo_lost',
  situacao_lance: 'situacao_lance',
  unidade_fornecimento: 'unidade_fornecimento',
} as const satisfies Partial<Record<keyof OportunidadeInput, string>>

/**
 * Torre calculada pela linha de serviço (regra da planilha): as linhas mapeadas vão para DIGITAL/HEALTH;
 * qualquer outra linha é ITS. `linhasTorre` vem de /api/opcoes (tabela linhas_torre).
 */
export function torreDaLinha(linhasTorre: Record<string, string>, linha: string | null | undefined): string | null {
  const l = (linha ?? '').trim()
  return l ? (linhasTorre[l] ?? 'ITS') : null
}

/** Registro como devolvido pela API (entrada + metadados). */
export type Oportunidade = OportunidadeInput & {
  id: number
  /** Código de negócio AAAA-NNNN (imutável); aparece no Radar e no título do cartão do Planner. */
  codigo: string | null
  versao: number
  fonte: 'planilha' | 'web'
  ano: string | null
  mes: string | null
  sla: number | null
  editado_na_web: boolean
  ausente_na_planilha: boolean
  criado_por: string | null
  criado_em: string | null
  atualizado_por: string | null
  atualizado_em: string | null
  arquivado_em: string | null
}

const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/**
 * Espelho no cliente das regras de negócio principais, só para feedback imediato.
 * O banco continua sendo a autoridade (`validar_oportunidade`).
 */
export function regrasNegocio(d: OportunidadeInput): ErroCampo[] {
  const erros: ErroCampo[] = []
  for (const campo of ['status', 'data_pregao_dt', 'orgao', 'descritivo', 'torre'] as const) {
    if (vazio(d[campo])) erros.push({ campo, mensagem: 'Campo obrigatório' })
  }
  if (d.data_distribuicao && d.data_pregao_dt && d.data_pregao_dt < d.data_distribuicao) {
    erros.push({ campo: 'data_pregao_dt', mensagem: 'A Data Pregão não pode ser anterior à data de distribuição' })
  }
  if (d.status === 'No Go' && vazio(d.motivo_no_go)) erros.push({ campo: 'motivo_no_go', mensagem: 'Informe o motivo do No Go' })
  if (d.status === 'Lost' && vazio(d.motivo_lost)) erros.push({ campo: 'motivo_lost', mensagem: 'Informe o motivo do Lost' })
  if (d.status === 'Win' && d.valor_ctc === null) erros.push({ campo: 'valor_ctc', mensagem: 'Informe o Valor CTC quando o status é Win' })
  if (d.orcamento_sigiloso && d.orcamento !== null) erros.push({ campo: 'orcamento', mensagem: 'Orçamento sigiloso não tem valor' })
  for (const campo of ['orcamento', 'valor_ctc', 'valor_vencedor', 'custo_total_ctc'] as const) {
    if (d[campo] !== null && d[campo] < 0) erros.push({ campo, mensagem: 'Não pode ser negativo' })
  }
  for (const campo of ['mc_ctc', 'simulacao_mc_arrematante'] as const) {
    if (d[campo] !== null && (d[campo] < -1 || d[campo] > 1)) erros.push({ campo, mensagem: 'Margem entre -100% e 100%' })
  }
  if (d.posicao_lance !== null && d.posicao_lance < 1) erros.push({ campo: 'posicao_lance', mensagem: 'Posição deve ser 1 ou maior' })
  if (d.orgao && d.orgao.length > 120) erros.push({ campo: 'orgao', mensagem: 'Máximo de 120 caracteres' })
  if (d.processo && d.processo.length > 60) erros.push({ campo: 'processo', mensagem: 'Máximo de 60 caracteres' })
  return erros
}
