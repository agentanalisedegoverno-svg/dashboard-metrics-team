import { rotaExterna } from '../../_lib/apiExterna.ts'
import { send } from '../../_lib/http.ts'
import { tratarMcp } from '../../_lib/mcpRemoto.ts'

/**
 * POST /api/externo/mcp: servidor MCP remoto SOMENTE LEITURA (Streamable HTTP, sem sessão). Exige chave de escopo `leitura`.
 * GET/DELETE -> 405 (não há fluxo de eventos nem sessão). Ver docs/MCP-REMOTO.md.
 *
 * Um navegador de outro site não deve conseguir usar esta rota: se a requisição traz `Origin`, ele tem de ser o do próprio site
 * (agentes como Claude.ai, Copilot Studio e CLIs chamam de servidor e não mandam `Origin`).
 */
export const onRequest = rotaExterna(
  {
    POST: async ({ leitor, request, corpo }) => {
      const origem = request.headers.get('origin')
      if (origem !== null && origem !== new URL(request.url).origin) return send(403, { error: 'Origem não permitida.' })
      const j = await corpo()
      if (j instanceof Response) return j
      return tratarMcp(j, leitor!)
    },
  },
  { POST: 'leitura' },
)
