import { atenderFonteExterna, caminhoDe, type EnvFontes } from '../_lib/fontesExternas.ts'

type Context = { request: Request; params: { path?: string | string[] }; env: EnvFontes }

/** /pncp/* (o que o front chama): proxy de leitura do PNCP, com a mesma guarda e lista fechada de /api/pncp/*. */
export const onRequest = ({ request, params, env }: Context): Promise<Response> => atenderFonteExterna(request, env, caminhoDe(params.path))
