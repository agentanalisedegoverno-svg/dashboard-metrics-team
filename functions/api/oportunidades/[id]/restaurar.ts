import { arquivar } from '../../../_lib/cadastro.ts'
import { agendarAposSalvar } from '../../../_lib/plannerNuvem.ts'
import { rota } from '../../../_lib/rota.ts'

export const onRequest = rota({
  POST: async ({ sql, email, params, env, waitUntil }) => {
    const res = await arquivar(sql, email, String(params.id), true)
    await agendarAposSalvar(res, env, waitUntil, String(params.id)) // restaurada volta a ser enviada ao Planner
    return res
  },
})
