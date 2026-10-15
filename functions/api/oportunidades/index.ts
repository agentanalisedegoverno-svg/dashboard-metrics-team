import { criar, listar } from '../../_lib/cadastro.ts'
import { comCorpo, rota } from '../../_lib/rota.ts'

export const onRequest = rota({
  GET: ({ sql, email, request }) => listar(sql, email, new URL(request.url).searchParams.get('arquivadas') === '1'),
  POST: ({ sql, email, corpo }) => comCorpo(corpo, (j) => criar(sql, email, j)),
})
