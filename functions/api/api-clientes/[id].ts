import { revogarCliente } from '../../_lib/apiExterna.ts'
import { rota } from '../../_lib/rota.ts'

/** DELETE /api/api-clientes/:id revoga a chave (não apaga o registro: o histórico de quem criou o quê permanece). */
export const onRequest = rota({
  DELETE: ({ sql, email, params }) => revogarCliente(sql, email, String(params.id)),
})
