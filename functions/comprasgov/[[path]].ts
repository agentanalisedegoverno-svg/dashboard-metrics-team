import { atenderFonteExterna, caminhoDe, type EnvFontes } from '../_lib/fontesExternas.ts'

type Context = { request: Request; params: { path?: string | string[] }; env: EnvFontes }

/** /comprasgov/*: proxy de leitura da API de Dados Abertos do Compras.gov.br. */
export const onRequest = ({ request, params, env }: Context): Promise<Response> =>
  atenderFonteExterna(request, env, 'comprasgov/' + caminhoDe(params.path))
