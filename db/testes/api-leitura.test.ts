/**
 * API de leitura (migração 029 + functions/_lib/leituraOportunidades.ts), contra o Postgres real em memória e com o papel
 * `radar_leitor` (só SELECT): prova que o SQL de verdade roda, filtra, pagina e que esse papel não consegue gravar.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from '../../functions/_lib/cadastro.ts'
import { listarParaLeitura, obterParaLeitura } from '../../functions/_lib/leituraOportunidades.ts'
import { ADMIN, como, criar, criarBanco, falha, opp, type Db } from './banco.ts'

let db: Db

/** Adaptador mínimo: o template `sql\`...\`` da API vira consulta parametrizada ($1, $2...) no banco de teste. */
const sqlDe = (d: Db) =>
  ((strings: TemplateStringsArray, ...valores: unknown[]) => d.query(strings.reduce((t, s, i) => t + s + (i < valores.length ? `$${i + 1}` : ''), ''), valores).then((r) => r.rows)) as unknown as Sql

const url = (qs = '') => new URL(`https://radar.test/api/externo/oportunidades${qs}`)
const lista = async (qs = '') => como(db, 'radar_leitor', async () => listarParaLeitura(sqlDe(db), url(qs)))
const corpo = async (qs = '') => (await lista(qs)).json() as Promise<{ total: number; limite: number; offset: number; proximo_offset: number | null; itens: Record<string, any>[] }>

beforeAll(async () => {
  db = await criarBanco()
  await criar(db, opp({ status: 'Go', orgao: 'Prefeitura Municipal de Campinas', uf: 'SP', orcamento: 500_000, data_pregao_dt: '2026-03-10', descritivo: 'Link dedicado' }))
  await criar(db, opp({ status: 'Win', orgao: 'Governo do Estado de Goiás', uf: 'GO', orcamento: 2_000_000, data_pregao_dt: '2026-05-20', valor_ctc: 1_800_000, descritivo: 'Service desk 50% de desconto' }))
  await criar(db, opp({ status: 'Go', orgao: 'Ministério da Saúde', uf: 'DF', orcamento: 9_000_000, data_pregao_dt: '2026-08-01', analista: 'Editor' }))
  await criar(db, opp({ status: 'Prospect', orgao: 'Acme Ltda', uf: 'SP', data_pregao_dt: '2026-09-15' }))
  const arquivada = await criar(db, opp({ status: 'Go', orgao: 'Órgão Arquivado', uf: 'RJ', orcamento: 100, data_pregao_dt: '2026-01-05' }))
  await db.query('select arquivar_oportunidade($1::bigint, $2, false)', [arquivada.id, ADMIN])
}, 120_000)

describe('listagem pelo papel radar_leitor', () => {
  it('lista as ativas com TODOS os campos (inclusive valores internos) e esconde as arquivadas', async () => {
    const r = await corpo()
    expect(r).toMatchObject({ total: 4, limite: 100, offset: 0, proximo_offset: null })
    expect(r.itens.map((i) => i.orgao)).not.toContain('Órgão Arquivado')
    const goiás = r.itens.find((i) => i.uf === 'GO')!
    expect(goiás).toMatchObject({ valor_ctc: 1_800_000, orcamento: 2_000_000, codigo: expect.stringMatching(/^\d{4}-\d{4}$/) })
    expect(Object.keys(goiás)).toEqual(expect.arrayContaining(['id', 'codigo', 'status', 'orgao', 'descritivo', 'orcamento', 'valor_ctc', 'valor_vencedor', 'criado_por', 'atualizado_em']))
  })

  it('arquivadas=true inclui as arquivadas (com arquivado_em preenchido)', async () => {
    const r = await corpo('?arquivadas=true')
    expect(r.total).toBe(5)
    expect(r.itens.find((i) => i.orgao === 'Órgão Arquivado')?.arquivado_em).toBeTruthy()
  })

  it('filtros: status (sem diferenciar maiúsculas), uf, órgão por trecho, analista por nome', async () => {
    expect((await corpo('?status=go')).itens.map((i) => i.uf).sort()).toEqual(['DF', 'SP'])
    expect((await corpo('?uf=sp')).total).toBe(2)
    expect((await corpo('?orgao=campinas')).total).toBe(1)
    expect((await corpo('?analista=edit')).itens.map((i) => i.orgao)).toEqual(['Ministério da Saúde'])
    expect((await corpo('?status=Go&uf=SP')).total).toBe(1) // filtros se combinam (E)
  })

  it('faixa de valor e de data do pregão; sem valor não entra quando há faixa', async () => {
    expect((await corpo('?valor_min=1000000')).itens.map((i) => i.uf).sort()).toEqual(['DF', 'GO'])
    expect((await corpo('?valor_min=1000000&valor_max=5000000')).itens.map((i) => i.uf)).toEqual(['GO'])
    expect((await corpo('?valor_max=600000')).itens.map((i) => i.uf)).toEqual(['SP']) // a Acme (sem orçamento) fica de fora
    expect((await corpo('?pregao_de=2026-04-01&pregao_ate=2026-08-31')).total).toBe(2)
    expect((await corpo('?pregao_de=2026-08-02')).total).toBe(1)
  })

  it('busca de texto: curingas do LIKE valem como texto puro', async () => {
    expect((await corpo('?q=link%20dedicado')).total).toBe(1)
    expect((await corpo('?q=%25')).itens.map((i) => i.uf)).toEqual(['GO']) // só quem tem "%" de verdade
    expect((await corpo('?q=_')).total).toBe(0) // "_" não é "qualquer caractere"
  })

  it('paginação: total fixo, proximo_offset e ordem estável por id', async () => {
    const p1 = await corpo('?limite=3')
    expect(p1).toMatchObject({ total: 4, limite: 3, offset: 0, proximo_offset: 3 })
    expect(p1.itens).toHaveLength(3)
    const p2 = await corpo('?limite=3&offset=3')
    expect(p2).toMatchObject({ total: 4, proximo_offset: null })
    expect(p2.itens).toHaveLength(1)
    const ids = [...p1.itens, ...p2.itens].map((i) => i.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(4)
  })

  it('atualizado_desde devolve só o que mudou depois', async () => {
    expect((await corpo('?atualizado_desde=2999-01-01')).total).toBe(0)
    expect((await corpo('?atualizado_desde=2000-01-01')).total).toBe(4)
  })

  it('injeção de SQL em filtro de texto é só texto: nada é encontrado e a tabela continua inteira', async () => {
    expect((await corpo(`?orgao=${encodeURIComponent("'; drop table oportunidades; --")}`)).total).toBe(0)
    expect((await corpo()).total).toBe(4)
  })
})

describe('detalhe pelo papel radar_leitor', () => {
  const um = async (codigo: string) => como(db, 'radar_leitor', async () => obterParaLeitura(sqlDe(db), codigo))

  it('acha por código e por id, com todos os campos; arquivada também é consultável; inexistente é 404', async () => {
    const todas = await corpo('?arquivadas=true')
    const alvo = todas.itens.find((i) => i.uf === 'GO')!
    const porCodigo = await um(alvo.codigo)
    expect(porCodigo.status).toBe(200)
    expect(await porCodigo.json()).toMatchObject({ id: alvo.id, valor_ctc: 1_800_000 })
    expect(((await (await um(String(alvo.id))).json()) as { codigo: string }).codigo).toBe(alvo.codigo)
    const arquivada = todas.itens.find((i) => i.orgao === 'Órgão Arquivado')!
    expect((await um(arquivada.codigo)).status).toBe(200)
    expect((await um('2099-9999')).status).toBe(404)
    expect((await um('999999')).status).toBe(404)
  })
})

describe('o papel radar_leitor não consegue gravar nada', () => {
  it.each([
    ["update oportunidades set status = 'Win'"],
    ["delete from oportunidades"],
    ["insert into api_clientes (nome, chave_hash, criado_por) values ('x-x-x', '" + 'a'.repeat(64) + "', 'a@b.c')"],
    ["update api_clientes set escopo = 'escrita'"],
  ])('%s -> permissão negada', async (comando) => {
    const f = await como(db, 'radar_leitor', () => falha(db.query(comando)))
    expect(f?.code).toBe('42501')
  })

  it('nem executa as funções de criação/autenticação de chave', async () => {
    for (const comando of ['select criar_oportunidade(\'{}\'::jsonb, \'a@b.c\')', "select autenticar_api_chave('" + 'a'.repeat(64) + "')", "select listar_api_clientes('a@b.c')"]) {
      const f = await como(db, 'radar_leitor', () => falha(db.query(comando)))
      expect(f?.code, comando).toBe('42501')
    }
  })
})
