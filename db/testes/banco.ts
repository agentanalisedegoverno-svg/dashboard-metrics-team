/**
 * Banco de teste: Postgres de verdade (PGlite, em memória) criado do zero com db/schema.sql + db/migrations/*.sql,
 * na mesma ordem e com o mesmo separador (;;) usados em produção. Nada aqui encosta no banco real.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(import.meta.dirname, '..')

export const ADMIN = 'admin@ctctech.com.br'
export const EDITOR = 'editor@ctctech.com.br'
export const VISUALIZADOR = 'viewer@ctctech.com.br'

/** Tira as linhas de comentário antes de separar (o cabeçalho da 001 cita ";;" num comentário). */
const instrucoes = (arquivo: string) =>
  readFileSync(arquivo, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';;')
    .map((s) => s.trim())
    .filter(Boolean)

export const migracoes = () =>
  readdirSync(join(RAIZ, 'migrations'))
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort()

/** Aplica uma migração (ou reaplica, para provar idempotência). */
export async function aplicarMigracao(db: Db, arquivo: string) {
  for (const s of instrucoes(join(RAIZ, 'migrations', arquivo))) {
    try {
      await db.exec(s)
    } catch (e) {
      throw new Error(`Falha em ${arquivo}: ${(e as Error).message}\n--- instrução ---\n${s.slice(0, 300)}`)
    }
  }
}

/** Cria o banco, aplica schema + migrações e semeia usuários mínimos (admin, editor com pré-vendas, visualizador). */
export async function criarBanco(opcoes: { semear?: boolean; ate?: string } = {}) {
  const db = new PGlite()
  await db.exec('CREATE ROLE radar_leitor NOLOGIN; CREATE ROLE radar_escritor NOLOGIN; CREATE ROLE radar_backup NOLOGIN;')
  await db.exec(readFileSync(join(RAIZ, 'schema.sql'), 'utf8'))
  for (const f of migracoes()) {
    if (opcoes.ate && f > opcoes.ate) break
    await aplicarMigracao(db, f)
  }
  if (opcoes.semear !== false) {
    await db.exec(`
      INSERT INTO usuarios (nome, email, admin, pre_vendas, ativo, somente_leitura) VALUES
        ('Admin', '${ADMIN}', true, false, true, false),
        ('Editor', '${EDITOR}', false, true, true, false),
        ('Viewer', '${VISUALIZADOR}', false, false, true, true)
      ON CONFLICT (nome) DO NOTHING;`)
  }
  return db
}

export type Db = PGlite

/** Payload mínimo válido de uma oportunidade (sobrescreva o que o teste precisa). */
export const opp = (extra: Record<string, unknown> = {}) => ({
  status: 'Go',
  orgao: 'Órgão de teste',
  descritivo: 'Descrição de teste',
  torre: 'ITS',
  data_pregao_dt: '2026-03-10',
  ...extra,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Reg = Record<string, any>

export async function criar(db: Db, payload: Record<string, unknown>, email = ADMIN): Promise<Reg> {
  const r = await db.query<{ o: Reg }>('select criar_oportunidade($1::jsonb, $2) as o', [JSON.stringify(payload), email])
  return r.rows[0].o
}

export async function atualizar(db: Db, id: number, versao: number, payload: Record<string, unknown>, email = ADMIN): Promise<Reg> {
  const r = await db.query<{ o: Reg }>('select atualizar_oportunidade($1::bigint, $2::int, $3::jsonb, $4) as o', [id, versao, JSON.stringify(payload), email])
  return r.rows[0].o
}

/** Resolve com {code, message} se a operação falhar (SQLSTATE próprio P0403/P0404/P0409/P0422), ou null se passar. */
export async function falha(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p
    return null
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message }
  }
}

/** Campos citados num erro de validação P0422. */
export const camposComErro = (f: { message: string } | null): string[] => {
  try {
    return (JSON.parse(f?.message ?? '[]') as { campo: string }[]).map((e) => e.campo)
  } catch {
    return []
  }
}

/** Executa com um papel do banco (privilégios reais) e volta ao superusuário no fim. */
export async function como<T>(db: Db, papel: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${papel}`)
  try {
    return await fn()
  } finally {
    await db.exec('RESET ROLE')
  }
}
