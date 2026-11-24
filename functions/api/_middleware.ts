import { comDiagnostico } from '../_lib/diagnostico.ts'

/**
 * Middleware de TODAS as rotas /api/*: marca a origem da resposta (x-radar-origem), o código da requisição (x-radar-req) e o tempo
 * (server-timing), e registra 5xx/429/lentidão no log. Fica em functions/api/ (e não na raiz) para não acionar funções nos arquivos
 * estáticos do site. Detalhes e como ler: docs/DIAGNOSTICO.md.
 */
export const onRequest = ({ request, next }: { request: Request; next: () => Promise<Response> }): Promise<Response> => comDiagnostico(request, next)
