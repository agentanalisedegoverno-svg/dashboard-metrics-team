import { rota, comCorpo } from '../../_lib/rota.ts'
import { vincularMonitoramento } from '../../_lib/monitorLicitacoes.ts'

export const onRequest = rota({
  PUT: ({ sql, email, params, corpo }) => comCorpo(corpo, (j) => vincularMonitoramento(sql, email, String(params.id ?? ''), j)),
})
