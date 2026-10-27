import { atualizar, obter } from '../../_lib/cadastro.ts'
import { comCorpo, rota } from '../../_lib/rota.ts'

export const onRequest = rota({
  GET: ({ sql, params }) => obter(sql, String(params.id)),
  PUT: ({ sql, email, params, corpo }) => comCorpo(corpo, (j) => atualizar(sql, email, String(params.id), j)),
}, { aoSalvar: 'integracoes' })
