import { z } from 'zod'

/**
 * Linha da aba "Base Governo". Somente leitura: este front NUNCA grava na
 * planilha original. `acaoIA` é apenas repassado (campo reservado a outro agente;
 * nenhuma visualização/métrica é construída sobre ele aqui).
 */
const str = z.string().nullish()
const numN = z.number().nullish()

export const RowSchema = z.looseObject({
  ano: str,
  mes: str,
  status: str,
  uf: str,
  torre: str,
  linhaServico: str,
  vistoria: str,
  analista: str,
  motivoNoGo: str,
  motivoLost: str,
  contaVinculada: str,
  orcamento: numN,
  valorCtc: numN,
  valorVencedor: numN,
  sla: numN,
  processo: str,
  orgao: str,
  descritivo: str,
  dataPregao: str,
  acaoIA: z.unknown().optional(),
})
export type Row = z.infer<typeof RowSchema>

export const DatasetSchema = z.array(RowSchema)

export type FilterDim = 'ano' | 'mes' | 'linhaServico' | 'torre' | 'status'
export const FILTER_DIMS: FilterDim[] = ['ano', 'mes', 'linhaServico', 'torre', 'status']
export const FILTER_LABELS: Record<FilterDim, string> = {
  ano: 'Ano',
  mes: 'Mês',
  linhaServico: 'Linha de Serviço',
  torre: 'Torre',
  status: 'Status',
}

export const NV = 'Sem informação'
