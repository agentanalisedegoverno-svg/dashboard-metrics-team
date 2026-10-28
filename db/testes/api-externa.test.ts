/**
 * API externa (migração 020): outra aplicação cria oportunidades como o cadastro manual.
 * Fixa, contra o banco real: autoria `api:<cliente>`, solicitante, idempotência, chaves só por administrador e o fluxo normal (e-mail).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, EDITOR, camposComErro, criar, criarBanco, falha, opp, type Db } from './banco.ts'

let db: Db
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

beforeAll(async () => {
  db = await criarBanco()
}, 120_000)

const api = async (p: Record<string, unknown>, cliente = 'sistema-x', solicitante: string | null = null, idem: string | null = null) =>
  (await db.query<{ o: Record<string, unknown> }>('select criar_oportunidade_api($1::jsonb, $2, $3, $4) as o', [JSON.stringify(p), cliente, solicitante, idem])).rows[0].o

describe('chaves da API (só administrador)', () => {
  it('administrador cria, lista e revoga; o banco guarda só o hash', async () => {
    const c = (await db.query<{ r: { id: number; nome: string } }>('select criar_api_cliente($1, $2, $3) as r', ['sistema-x', HASH_A, ADMIN])).rows[0].r
    expect(c.nome).toBe('sistema-x')
    const lista = (await db.query<{ r: { nome: string; ativo: boolean; chave_hash?: string }[] }>('select listar_api_clientes($1) as r', [ADMIN])).rows[0].r
    expect(lista.map((x) => x.nome)).toEqual(['sistema-x'])
    expect(JSON.stringify(lista)).not.toContain(HASH_A) // a listagem nunca devolve o hash
    expect((await db.query<{ n: string }>('select autenticar_api_cliente($1) as n', [HASH_A])).rows[0].n).toBe('sistema-x')
    expect((await db.query<{ n: string | null }>('select autenticar_api_cliente($1) as n', [HASH_B])).rows[0].n).toBeNull()
    await db.query('select revogar_api_cliente($1::bigint, $2)', [c.id, ADMIN])
    expect((await db.query<{ n: string | null }>('select autenticar_api_cliente($1) as n', [HASH_A])).rows[0].n).toBeNull() // revogada
  })

  it('quem não é administrador não cria, lista nem revoga', async () => {
    for (const sql of [
      [`select criar_api_cliente('intruso', '${HASH_B}', $1)`, [EDITOR]],
      ['select listar_api_clientes($1)', [EDITOR]],
      ['select revogar_api_cliente(1::bigint, $1)', [EDITOR]],
    ] as const) {
      const f = await falha(db.query(sql[0], [...sql[1]]))
      expect(f?.code, sql[0]).toBe('P0403')
    }
  })

  it('nome inválido, repetido e hash inválido são recusados', async () => {
    expect(camposComErro(await falha(db.query('select criar_api_cliente($1, $2, $3)', ['AB', HASH_B, ADMIN])))).toContain('nome')
    expect(camposComErro(await falha(db.query('select criar_api_cliente($1, $2, $3)', ['sistema-x', HASH_B, ADMIN])))).toContain('nome') // já existe
    expect(camposComErro(await falha(db.query('select criar_api_cliente($1, $2, $3)', ['outro-sistema', 'curto', ADMIN])))).toContain('chave')
  })
})

describe('criar_oportunidade_api: mesmo fluxo do cadastro manual', () => {
  it('cria como web, com autoria api:<cliente> e o solicitante; o cadastro manual não tem solicitante', async () => {
    const o = await api(opp({ status: 'Prospect' }), 'sistema-x', 'Maria (Contratos)')
    expect(o).toMatchObject({ fonte: 'web', criado_por: 'api:sistema-x', solicitante: 'Maria (Contratos)', versao: 1 })
    expect(String(o.codigo)).toMatch(/^\d{4}-\d{4}$/)
    const manual = await criar(db, opp({ status: 'Prospect' }))
    expect(manual.solicitante).toBeNull()
    expect(manual.criado_por).toBe(ADMIN)
    const outraApi = await api(opp(), 'sistema-x') // sem solicitante informado
    expect(outraApi.solicitante).toBeNull()
    expect(outraApi.data_distribuicao).toBeNull() // a API não preenche sozinha (o formulário web é que sugere o dia)
  })

  it('aplica as mesmas validações do cadastro manual (campos obrigatórios, listas, regras por status)', async () => {
    expect(camposComErro(await falha(api({ status: 'Go' })))).toEqual(expect.arrayContaining(['orgao', 'descritivo', 'data_pregao_dt']))
    expect(camposComErro(await falha(api(opp({ status: 'Inventado' }))))).toContain('status')
    expect(camposComErro(await falha(api(opp({ status: 'No Go' }))))).toContain('motivo_no_go')
    expect(camposComErro(await falha(api(opp({ sigla: 'x'.repeat(21) }))))).toContain('sigla')
    expect(camposComErro(await falha(api(opp({ duracao_contrato_meses: 601 }))))).toContain('duracao_contrato_meses')
  })

  it('solicitante com mais de 120 caracteres e cliente inválido são recusados', async () => {
    expect(camposComErro(await falha(api(opp(), 'sistema-x', 'x'.repeat(121))))).toContain('solicitante')
    expect((await falha(api(opp(), 'Cliente Inválido')))?.code).toBe('P0403')
  })

  it('o aviso de nova oportunidade entra na fila, como no cadastro manual', async () => {
    await db.query(`select salvar_email_config(true, ARRAY['Prospect'], '[{"email":"a@x.com"}]'::jsonb, $1, false)`, [ADMIN])
    const o = await api(opp({ status: 'Prospect' }), 'sistema-x', 'João')
    const fila = await db.query<{ tipo: string; situacao: string }>('select tipo, situacao from email_fila where oportunidade_id = $1', [o.id])
    expect(fila.rows).toEqual([{ tipo: 'nova', situacao: 'pendente' }])
  })
})

describe('idempotência (Idempotency-Key)', () => {
  it('repetir a chamada com a mesma chave devolve a mesma oportunidade, sem duplicar', async () => {
    const antes = Number((await db.query<{ n: string }>('select count(*) as n from oportunidades')).rows[0].n)
    const a = await api(opp({ descritivo: 'Idempotente' }), 'sistema-x', 'Ana', 'pedido-123')
    const b = await api(opp({ descritivo: 'Idempotente' }), 'sistema-x', 'Ana', 'pedido-123')
    expect(b.id).toBe(a.id)
    expect(b.idempotente).toBe(true)
    expect(a.idempotente).toBeUndefined()
    const depois = Number((await db.query<{ n: string }>('select count(*) as n from oportunidades')).rows[0].n)
    expect(depois - antes).toBe(1)
    const filas = Number((await db.query<{ n: string }>('select count(*) as n from email_fila where oportunidade_id = $1', [a.id])).rows[0].n)
    expect(filas).toBeLessThanOrEqual(1) // um único aviso
  })

  it('chaves diferentes criam oportunidades diferentes; a mesma chave em outro cliente também', async () => {
    const a = await api(opp(), 'sistema-x', null, 'k-1')
    const b = await api(opp(), 'sistema-x', null, 'k-2')
    const c = await api(opp(), 'outro-sistema', null, 'k-1')
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
  })

  it('falha de validação não consome a chave: a aplicação corrige e repete com a mesma chave', async () => {
    expect(await falha(api({ status: 'Go' }, 'sistema-x', null, 'k-corrige'))).not.toBeNull()
    const ok = await api(opp(), 'sistema-x', null, 'k-corrige')
    expect(ok.fonte).toBe('web')
    expect(ok.idempotente).toBeUndefined()
  })

  it('Idempotency-Key fora do tamanho é recusada', async () => {
    expect(camposComErro(await falha(api(opp(), 'sistema-x', null, 'x'.repeat(101))))).toContain('Idempotency-Key')
  })
})
