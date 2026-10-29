import { salvarLinhaTorre } from '../_lib/cadastro.ts'
import { comCorpo, rota } from '../_lib/rota.ts'

/** PUT /api/linhas-torre: define a torre de uma linha de serviço (só administrador; o banco confere). */
export const onRequest = rota({
  PUT: ({ sql, email, corpo }) => comCorpo(corpo, (j) => salvarLinhaTorre(sql, email, j)),
})
