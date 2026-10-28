import { chaveIdempotencia, rotaExterna, separarSolicitante } from '../../_lib/apiExterna.ts'
import { criar } from '../../_lib/cadastro.ts'
import { consultaCnpj } from '../../_lib/cnpj.ts'

/**
 * POST /api/externo/oportunidades: cria uma oportunidade como o cadastro manual (mesmos campos, validações, e-mail e Planner).
 * Corpo: os campos da oportunidade + `solicitante` (opcional). Cabeçalho opcional `Idempotency-Key`. Ver docs/API-EXTERNA.md.
 */
export const onRequest = rotaExterna({
  POST: async ({ sql, cliente, request, corpo }) => {
    const idem = chaveIdempotencia(request)
    if (idem instanceof Response) return idem
    const j = await corpo()
    if (j instanceof Response) return j
    const sep = separarSolicitante(j)
    if (sep instanceof Response) return sep
    return criar(sql, `api:${cliente}`, sep.dados, consultaCnpj, { cliente, solicitante: sep.solicitante, idem })
  },
})
