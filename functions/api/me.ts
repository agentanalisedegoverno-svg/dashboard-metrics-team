import { me } from '../_lib/cadastro.ts'
import { rota } from '../_lib/rota.ts'

export const onRequest = rota({ GET: ({ sql, email }) => me(sql, email) })
