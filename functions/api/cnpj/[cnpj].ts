import { consultaCnpj } from '../../_lib/cnpj.ts'
import { send } from '../../_lib/http.ts'
import { rota } from '../../_lib/rota.ts'

/** GET /api/cnpj/:cnpj — razão social e matriz/filial na Receita (exige login; não usa o banco). */
export const onRequest = rota(
  {
    GET: async ({ params }) => {
      const r = await consultaCnpj(String(params.cnpj))
      if (r.ok) return send(200, r.empresa)
      const status = r.motivo === 'invalido' ? 422 : r.motivo === 'nao_encontrado' ? 404 : 503
      return send(status, { error: r.mensagem, motivo: r.motivo })
    },
  },
  { semBanco: true },
)
