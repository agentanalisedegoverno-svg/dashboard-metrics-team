import { rota, comCorpo } from '../../../_lib/rota.ts'
import { atualizarAlerta } from '../../../_lib/monitorLicitacoes.ts'

export const onRequest = rota({
  PATCH: ({ sql, email, params, corpo }) => comCorpo(corpo, (j) => atualizarAlerta(sql, email, String(params.id ?? ''), j)),
})
