import { rotaExterna } from '../../../_lib/apiExterna.ts'
import { obterParaLeitura } from '../../../_lib/leituraOportunidades.ts'

type Ctx = Parameters<ReturnType<typeof rotaExterna>>[0] & { params: { codigo?: string | string[] } }

/** GET /api/externo/oportunidades/{codigo}: uma oportunidade (código AAAA-NNNN ou id), todos os campos. Só leitura (chave de escopo `leitura`). */
export const onRequest = (c: Ctx) => {
  const codigo = [c.params.codigo].flat()[0] ?? ''
  return rotaExterna({ GET: async ({ leitor }) => obterParaLeitura(leitor!, codigo) }, { GET: 'leitura' })(c)
}