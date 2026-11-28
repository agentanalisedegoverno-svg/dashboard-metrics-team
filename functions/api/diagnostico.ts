import type { Sql } from '../_lib/cadastro.ts'
import { dentroDoLimite, entradaTempo } from '../_lib/diagnostico.ts'
import { bancoApp, send } from '../_lib/http.ts'
import { comLeitura, usaHyperdrive } from '../_lib/leitura.ts'
import { consultarPainel, corpoDoPainel } from '../_lib/painel.ts'
import { rota } from '../_lib/rota.ts'

/** Só o tipo do erro (código do driver ou nome), nunca a mensagem: ela pode trazer host, usuário ou trecho de SQL. */
const tipoDoErro = (e: unknown) => String((e as { code?: string })?.code ?? (e as Error)?.name ?? 'erro').slice(0, 40)

type Verificacao = { nome: string; ok: boolean; ms: number; detalhe?: string; erro?: string }

async function verificar(nome: string, fn: () => Promise<string | undefined>): Promise<Verificacao> {
  const t = Date.now()
  try {
    const detalhe = await fn()
    return { nome, ok: true, ms: Date.now() - t, ...(detalhe ? { detalhe } : {}) }
  } catch (e) {
    return { nome, ok: false, ms: Date.now() - t, erro: tipoDoErro(e) }
  }
}

/**
 * GET /api/diagnostico: relatório para o suporte quando o painel falha. Exige login (Access). Roda de verdade, no servidor:
 * configuração (só presente/ausente), conexão com o banco pelos dois papéis e a MESMA consulta do painel (/api/rows), com tempo e
 * tamanho. Não devolve segredo, URL de banco nem mensagem de erro do banco. Limite: 6 chamadas por minuto por usuário.
 */
export const onRequest = rota(
  {
    GET: async ({ email, request, env }) => {
      if (!dentroDoLimite(`diag:${email}`, 6)) return send(429, { error: 'Muitos diagnósticos seguidos. Aguarde um minuto.' })
      const cf = (request as Request & { cf?: { colo?: string; country?: string } }).cf
      const checks: Verificacao[] = []
      // Rota sem o atalho do banco: se a variável faltar, o relatório precisa DIZER isso (e não responder 503 sem explicar).
      const cadastro = bancoApp(env) as Sql | null
      if (cadastro) checks.push(await verificar('banco (papel do cadastro)', async () => void (await cadastro`select 1`)))
      else checks.push({ nome: 'banco (papel do cadastro)', ok: false, ms: 0, erro: 'DATABASE_URL_APP ausente' })
      if (env.DATABASE_URL) {
        // Pelo mesmo caminho do painel: com o Hyperdrive configurado, é por ele que a leitura passa.
        checks.push(await verificar('banco (papel do painel)', async () => void (await comLeitura(env, (sql) => sql`select 1`))))
        checks.push(
          await verificar('consulta do painel (/api/rows)', async () => {
            const p = await comLeitura(env, consultarPainel)
            return `${p.total} linhas, ${Math.round(corpoDoPainel(p).length / 1024)} KB`
          }),
        )
      } else {
        checks.push({ nome: 'banco (papel do painel)', ok: false, ms: 0, erro: 'DATABASE_URL ausente' })
      }
      const resposta = {
        ok: checks.every((c) => c.ok),
        quando: new Date().toISOString(),
        ray: request.headers.get('cf-ray'),
        colo: cf?.colo ?? null,
        pais: cf?.country ?? null,
        config: {
          access: Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD),
          acesso_publico: env.ACESSO_PUBLICO === 'true',
          banco_cadastro: Boolean(env.DATABASE_URL_APP),
          banco_painel: Boolean(env.DATABASE_URL),
          hyperdrive: usaHyperdrive(env),
        },
        checks,
      }
      const r = send(200, resposta)
      r.headers.set('server-timing', checks.map((c, i) => entradaTempo(`c${i + 1}`, c.ms)).join(', '))
      return r
    },
  },
  { semBanco: true },
)
