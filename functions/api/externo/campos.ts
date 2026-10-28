import { catalogoCampos, REGRAS, rotaExterna } from '../../_lib/apiExterna.ts'
import { send } from '../../_lib/http.ts'

/** GET /api/externo/campos: catálogo dos campos aceitos (gerado do formulário), com os valores válidos das listas e as regras. */
export const onRequest = rotaExterna({
  GET: async ({ sql }) => {
    const linhas = (await sql`select lista, valor, ativo from opcoes order by lista, ordem, valor`) as { lista: string; valor: string; ativo: boolean }[]
    const listas: Record<string, { valor: string; ativo: boolean }[]> = {}
    for (const o of linhas) (listas[o.lista] ??= []).push({ valor: o.valor, ativo: o.ativo })
    return send(200, { campos: catalogoCampos(listas), extras: [{ nome: 'solicitante', formato: 'texto até 120 caracteres', obrigatorio: false, dica: 'Quem pediu a criação na aplicação externa' }], regras: REGRAS })
  },
})
