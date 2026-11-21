import { atenderFonteExterna, type EnvFontes } from './_lib/fontesExternas.ts'

type Context = { request: Request; env: EnvFontes }

/** /conlicitacao: boletins da conta ConLicitações (somente leitura). */
export const onRequest = ({ request, env }: Context): Promise<Response> => atenderFonteExterna(request, env, 'conlicitacao')
