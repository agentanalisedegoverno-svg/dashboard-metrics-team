import { arquivar } from '../../../_lib/cadastro.ts'
import { rota } from '../../../_lib/rota.ts'

export const onRequest = rota({ POST: ({ sql, email, params }) => arquivar(sql, email, String(params.id), true) })
