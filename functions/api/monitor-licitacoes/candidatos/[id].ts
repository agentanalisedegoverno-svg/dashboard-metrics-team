import { rota } from '../../../_lib/rota.ts'
import { buscarCandidatosPncp } from '../../../_lib/monitorLicitacoes.ts'

export const onRequest = rota({
  GET: ({ sql, params }) => buscarCandidatosPncp(sql, String(params.id ?? '')),
})
