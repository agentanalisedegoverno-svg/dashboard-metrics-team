import { salvarUsuario } from '../_lib/cadastro.ts'
import { comCorpo, rota } from '../_lib/rota.ts'

export const onRequest = rota({ PUT: ({ sql, email, corpo }) => comCorpo(corpo, (j) => salvarUsuario(sql, email, j)) })
