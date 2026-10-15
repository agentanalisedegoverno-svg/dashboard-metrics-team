/**
 * Contrato do cadastro de oportunidades, compartilhado entre a API (Pages Functions) e o front.
 * Aqui só se garante FORMATO (tipos, tamanhos, vazio -> null). As regras de negócio (listas fechadas,
 * obrigatoriedade por status, datas) vivem no banco (`validar_oportunidade`), que é a fonte da verdade.
 */
import { z } from 'zod'

const vazioParaNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

const texto = (max: number) =>
  z.preprocess(vazioParaNull, z.string().max(max, `Máximo de ${max} caracteres`).nullable().optional()).transform((v) => v ?? null)

const numero = z
  .preprocess((v) => {
    const s = vazioParaNull(v)
    return typeof s === 'string' ? Number(s.replace(',', '.')) : s
  }, z.number({ error: 'Número inválido' }).finite('Número inválido').nullable().optional())
  .transform((v) => v ?? null)

const inteiro = z
  .preprocess(vazioParaNull, z.number({ error: 'Número inválido' }).int('Deve ser inteiro').nullable().optional())
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
  descritivo: texto(1000),
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
  empresas_vencedoras: texto(1000),
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
