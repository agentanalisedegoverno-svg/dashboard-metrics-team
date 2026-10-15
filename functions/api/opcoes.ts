import { opcoes, salvarOpcao } from '../_lib/cadastro.ts'
import { comCorpo, rota } from '../_lib/rota.ts'

export const onRequest = rota({
  GET: ({ sql, email }) => opcoes(sql, email),
  PUT: ({ sql, email, corpo }) => comCorpo(corpo, (j) => salvarOpcao(sql, email, j)),
})
