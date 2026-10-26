import { atualizar, obter } from '../../_lib/cadastro.ts'
import { agendarAposSalvar } from '../../_lib/plannerNuvem.ts'
import { comCorpo, rota } from '../../_lib/rota.ts'

export const onRequest = rota({
  GET: ({ sql, params }) => obter(sql, String(params.id)),
  PUT: ({ sql, email, params, corpo, env, waitUntil }) =>
    comCorpo(corpo, async (j) => {
      const res = await atualizar(sql, email, String(params.id), j)
      await agendarAposSalvar(res, env, waitUntil, String(params.id))
      return res
    }),
})
