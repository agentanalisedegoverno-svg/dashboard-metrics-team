import { arquivarLote } from '../../_lib/cadastro.ts'
import { comCorpo, rota } from '../../_lib/rota.ts'

/** POST { ids: number[] }: arquiva em lote, só oportunidades ativas no status Radar-TIC (administradores). */
export const onRequest = rota({ POST: ({ sql, email, corpo }) => comCorpo(corpo, (j) => arquivarLote(sql, email, j)) })
