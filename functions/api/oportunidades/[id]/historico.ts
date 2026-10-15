import { historico } from '../../../_lib/cadastro.ts'
import { rota } from '../../../_lib/rota.ts'

export const onRequest = rota({ GET: ({ sql, params }) => historico(sql, String(params.id)) })
