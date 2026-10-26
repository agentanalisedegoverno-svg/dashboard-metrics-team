import { criar, listar } from '../../_lib/cadastro.ts'
import { agendarAposSalvar } from '../../_lib/plannerNuvem.ts'
import { comCorpo, rota } from '../../_lib/rota.ts'

export const onRequest = rota({
  GET: ({ sql, email, request }) => listar(sql, email, new URL(request.url).searchParams.get('arquivadas') === '1'),
  POST: ({ sql, email, corpo, env, waitUntil }) =>
    comCorpo(corpo, async (j) => {
      const res = await criar(sql, email, j)
      await agendarAposSalvar(res, env, waitUntil) // Planner em tempo real (só se o modo nuvem estiver configurado e ligado)
      return res
    }),
})
