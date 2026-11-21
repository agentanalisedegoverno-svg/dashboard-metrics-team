import { atenderFonteExterna, caminhoDe, type EnvFontes } from '../../_lib/fontesExternas.ts'

type Context = { request: Request; params: { path?: string | string[] }; env: EnvFontes }

/** /api/pncp/*: no Cloudflare Pages, functions/api/[[path]].ts captura /api/* antes de qualquer outra coisa, então esta rota específica precisa existir. */
export const onRequest = ({ request, params, env }: Context): Promise<Response> => atenderFonteExterna(request, env, caminhoDe(params.path))
