/** Contrato da configuração de e-mail das novas oportunidades (compartilhado entre a API e a tela de administração). */
import { z } from 'zod'

export const destinatarioInput = z.object({
  email: z.string().trim().toLowerCase().max(254, 'E-mail muito longo').regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'E-mail inválido'),
  tipo: z.enum(['para', 'cc']).default('para'),
  ativo: z.boolean().default(true),
})

export const emailConfigInput = z.object({
  ativo: z.boolean(),
  /** Avisa também o pré-vendas escolhido na oportunidade (se tiver e-mail cadastrado). */
  avisar_pre_vendas: z.boolean().default(false),
  status: z.array(z.string().trim().min(1).max(60)).max(30),
  destinatarios: z.array(destinatarioInput).max(30, 'No máximo 30 destinatários'),
})

export type Destinatario = z.infer<typeof destinatarioInput>
export type EmailConfigInput = z.infer<typeof emailConfigInput>

export type EnvioRecente = {
  id: number
  tipo: 'nova' | 'teste'
  situacao: 'pendente' | 'enviado' | 'erro' | 'ignorado'
  tentativas: number
  ultimo_erro: string | null
  criado_em: string
  enviado_em: string | null
  codigo: string | null
  orgao: string | null
}

export type EmailConfig = EmailConfigInput & {
  atualizado_por: string | null
  atualizado_em: string | null
  recentes: EnvioRecente[]
}
