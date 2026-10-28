import { rota } from '../../_lib/rota.ts'
import { listarMonitoramento } from '../../_lib/monitorLicitacoes.ts'

export const onRequest = rota({
  GET: ({ sql }) => listarMonitoramento(sql),
})
