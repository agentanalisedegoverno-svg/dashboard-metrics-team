/**
 * Conexão de LEITURA do painel (papel `radar_leitor`): pelo Hyperdrive quando o binding `HYPERDRIVE` existe, senão direto pela
 * `DATABASE_URL`, como sempre foi.
 *
 * POR QUE: no plano gratuito do Workers cada requisição tem ~10 ms de CPU e, sem Hyperdrive, cada uma abre uma conexão nova com o
 * Postgres (TLS + autenticação SCRAM). É o maior custo de CPU de /api/rows num "miss" do cache (ver cachePainel.ts) e a causa dos
 * erros 1102 ("Worker exceeded resource limits"). O Hyperdrive mantém as conexões abertas no Cloudflare: o Worker só fala com ele,
 * sem TLS e sem autenticação por requisição.
 *
 * FALHA SEGURA: o Hyperdrive é opcional. Sem o binding, tudo funciona como antes. Com o binding mas com defeito (configuração
 * errada, serviço fora), a leitura tenta de novo direto pela `DATABASE_URL` em vez de devolver erro.
 */
import { conectar } from './banco'
import type { Sql } from './cadastro.ts'

export type Hyperdrive = { connectionString: string }
export type EnvLeitura = { DATABASE_URL?: string; HYPERDRIVE?: Hyperdrive }

/** Só o tipo do erro (código do driver ou nome), nunca a mensagem: ela pode trazer host, usuário ou trecho de SQL. */
const tipoDoErro = (e: unknown) => String((e as { code?: string })?.code ?? (e as Error)?.name ?? 'erro').slice(0, 40)

export const usaHyperdrive = (env: EnvLeitura) => Boolean(env.HYPERDRIVE?.connectionString)

/** Executa `fn` com uma conexão de leitura (Hyperdrive, com volta para a conexão direta se ele falhar). */
export async function comLeitura<T>(env: EnvLeitura, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const hd = env.HYPERDRIVE?.connectionString
  if (hd) {
    try {
      return await fn(conectar(hd, { hyperdrive: true }) as unknown as Sql)
    } catch (e) {
      if (!env.DATABASE_URL) throw e
      console.error('Hyperdrive falhou; usando a conexão direta:', tipoDoErro(e))
    }
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL ausente')
  return fn(conectar(env.DATABASE_URL) as unknown as Sql)
}
