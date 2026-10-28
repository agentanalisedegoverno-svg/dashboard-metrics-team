import { criarCliente, listarClientes } from '../_lib/apiExterna.ts'
import { comCorpo, rota } from '../_lib/rota.ts'

/** Administração das chaves da API externa (só administrador; Cloudflare Access + CSRF como as demais rotas de cadastro). */
export const onRequest = rota({
  GET: ({ sql, email }) => listarClientes(sql, email),
  POST: ({ sql, email, corpo }) => comCorpo(corpo, (j) => criarCliente(sql, email, j)),
})
