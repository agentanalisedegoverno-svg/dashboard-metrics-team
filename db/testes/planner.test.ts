/**
 * Regra de atualização Radar -> Planner, lado do Radar: QUANDO uma oportunidade vira evento.
 * A consulta é extraída de scripts/planner-eventos.mjs (a que roda em produção) e executada num banco criado do zero:
 * se alguém mudar a regra no script, estes testes (e docs/INTEGRACAO-PLANNER.md) precisam mudar junto.
 */
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { montarEvento, type MapaPlanner, type OportunidadePlanner } from '../../functions/_lib/planner.ts'
import { ADMIN, atualizar, criar, criarBanco, opp, type Db } from './banco.ts'

const script = readFileSync('scripts/planner-eventos.mjs', 'utf8')
const SQL_PENDENTES = /const pendentes = await sql`([\s\S]*?)`/.exec(script)![1].replace('${marco}', '$1')
const SQL_MARCAR = /await sql`\s*(insert into planner_exportacao[\s\S]*?)`/.exec(script)![1].replace('${o.id}', '$1').replace('${o.versao}', '$2').replace('${ev.chave}', '$3')
const mapa = JSON.parse(readFileSync('config/planner-mapa.json', 'utf8')) as MapaPlanner

let db: Db
let marco: string
beforeAll(async () => {
  expect(SQL_PENDENTES, 'a consulta do script não pode ter outros parâmetros').not.toMatch(/\$\{/)
  expect(SQL_MARCAR).not.toMatch(/\$\{/)
  db = await criarBanco()
  marco = new Date(Date.now() - 60 * 60_000).toISOString() // a integração foi "ativada" há 1 hora
}, 120_000)

type Pendente = { id: number; codigo: string; versao: number; versao_exportada: number | null }
const pendentes = async () => (await db.query<Pendente>(SQL_PENDENTES, [marco])).rows
const doCodigo = async (codigo: string) => (await pendentes()).find((p) => p.codigo === codigo)
/** Mesma regra do script: nunca exportada = "nova"; já exportada = "atualizada". */
const tipoDe = (p: Pendente) => (p.versao_exportada == null ? 'oportunidade_nova' : 'oportunidade_atualizada')
const marcarExportada = (p: Pendente) => db.query(SQL_MARCAR, [p.id, p.versao, p.codigo])

describe('quando o Radar manda um evento ao Planner', () => {
  it('o script usa a mesma regra de tipo que estes testes (nova se nunca exportada)', () => {
    expect(script).toMatch(/const tipo = o\.versao_exportada == null \? 'oportunidade_nova' : 'oportunidade_atualizada'/)
  })

  it('oportunidade criada pela web depois do marco entra como "nova"', async () => {
    const o = await criar(db, opp({ orgao: 'Nova na web' }))
    const p = await doCodigo(o.codigo)
    expect(p).toBeTruthy()
    expect(tipoDe(p!)).toBe('oportunidade_nova')
  })

  it('depois de exportada, só volta quando alguém salva de novo no Radar (e então como "atualizada")', async () => {
    const o = await criar(db, opp({ orgao: 'Exportada uma vez' }))
    await marcarExportada((await doCodigo(o.codigo))!)
    expect(await doCodigo(o.codigo)).toBeUndefined() // nada mudou: nada a enviar
    await atualizar(db, o.id, o.versao, opp({ orgao: 'Exportada uma vez', observacoes: 'mudou' }))
    const p = await doCodigo(o.codigo)
    expect(tipoDe(p!)).toBe('oportunidade_atualizada')
    expect(p!.versao).toBe(o.versao + 1)
  })

  it('QUALQUER edição gera atualização, até de campo que o cartão nem mostra (ex.: impostos)', async () => {
    const o = await criar(db, opp({ orgao: 'Edita imposto' }))
    await marcarExportada((await doCodigo(o.codigo))!)
    await atualizar(db, o.id, o.versao, opp({ orgao: 'Edita imposto', impostos: 0.0865 }))
    expect(tipoDe((await doCodigo(o.codigo))!)).toBe('oportunidade_atualizada')
  })

  it('várias edições entre duas rodadas viram UM envio, com a versão final', async () => {
    const o = await criar(db, opp({ orgao: 'Muitas edições' }))
    await marcarExportada((await doCodigo(o.codigo))!)
    let versao = o.versao as number
    for (let i = 0; i < 3; i++) versao = (await atualizar(db, o.id, versao, opp({ orgao: 'Muitas edições', observacoes: `edição ${i}` }))).versao
    const lista = (await pendentes()).filter((p) => p.codigo === o.codigo)
    expect(lista).toHaveLength(1)
    expect(lista[0].versao).toBe(versao)
  })

  it('o que veio da planilha nunca é enviado', async () => {
    await db.query(`select sincronizar_planilha('[{"chave_planilha":"pl-1","status":"Go","orgao":"Da planilha","descritivo":"x","torre":"ITS","data_pregao_dt":"2026-04-01"}]'::jsonb, 'teste', false)`)
    const r = await db.query<{ id: number }>(`select id from oportunidades where chave_planilha = 'pl-1'`)
    expect((await pendentes()).some((p) => p.id === r.rows[0].id)).toBe(false)
  })

  it('o que foi criado antes do marco nunca é enviado, mesmo sendo da web', async () => {
    const o = await criar(db, opp({ orgao: 'Anterior ao marco' }))
    await db.query(`update oportunidades set criado_em = now() - interval '1 day' where id = $1`, [o.id])
    expect(await doCodigo(o.codigo)).toBeUndefined()
  })

  it('arquivada não é enviada; ao restaurar, volta a ser enviada', async () => {
    const o = await criar(db, opp({ orgao: 'Vai ser arquivada' }))
    await marcarExportada((await doCodigo(o.codigo))!)
    await db.query('select arquivar_oportunidade($1::bigint, $2, false)', [o.id, ADMIN])
    expect(await doCodigo(o.codigo)).toBeUndefined() // o cartão fica como está no Planner
    await db.query('select arquivar_oportunidade($1::bigint, $2, true)', [o.id, ADMIN])
    expect(tipoDe((await doCodigo(o.codigo))!)).toBe('oportunidade_atualizada')
  })
})

describe('o que o evento leva (com o mapa real config/planner-mapa.json)', () => {
  const base = (status: string | null, torre: string): OportunidadePlanner => ({
    id: 1, codigo: '2026-0001', versao: 2, status, torre, orgao: 'SEDES', descritivo: 'Link', processo: '1/2026', uasg: '158443',
    data_pregao_dt: '2026-11-05', analista: 'Julio', linha_servico: 'Service Desk', observacoes: null, orcamento: 1000, orcamento_sigiloso: false,
  })

  it.each(Object.entries(mapa.planos).flatMap(([chave, plano]) => Object.keys(plano.buckets).filter((s) => s !== '_sem_status').map((status) => [chave, plano.nome, status, plano.buckets[status], plano.torres[0]] as const)))(
    '%s (%s): status %s vai para o bucket "%s"',
    (_chave, _nome, status, bucket, torre) => {
      const e = montarEvento(base(status, torre), 'oportunidade_atualizada', mapa, () => 'a@x.com')!
      expect(e.cartao.bucket).toBe(bucket)
      expect(e.cartao.progresso).toBe(mapa.progresso[status])
    },
  )

  it('sem status cai no bucket de "sem status" de cada plano, com 0%', () => {
    for (const plano of Object.values(mapa.planos)) {
      const e = montarEvento(base(null, plano.torres[0]), 'oportunidade_nova', mapa, () => null)!
      expect(e.cartao.bucket).toBe(plano.buckets._sem_status)
      expect(e.cartao.progresso).toBe(0)
    }
  })

  it('a atualização não leva o checklist (só a criação); o prazo é a data do pregão', () => {
    const nova = montarEvento(base('Go', 'ITS'), 'oportunidade_nova', mapa, () => null)!
    const atualizada = montarEvento(base('Go', 'ITS'), 'oportunidade_atualizada', mapa, () => null)!
    expect(nova.cartao.checklist).toHaveLength(7)
    expect(atualizada.cartao.checklist).toEqual([])
    expect(atualizada.cartao.prazo).toBe('2026-11-05T12:00:00Z')
  })

  it('mudar a torre muda o plano do evento (e a chave continua a mesma)', () => {
    const its = montarEvento(base('Go', 'ITS'), 'oportunidade_atualizada', mapa, () => null)!
    const dig = montarEvento(base('Go', 'DIGITAL'), 'oportunidade_atualizada', mapa, () => null)!
    expect(its.chave).toBe(dig.chave)
    expect(its.plano).not.toBe(dig.plano)
  })
})

describe('a consulta do exportador leva o objeto e a hora do pregão', () => {
  it('devolve os campos novos (em branco quando não preenchidos) e a hora como texto HH:MM:SS', async () => {
    const com = await criar(db, opp({ orgao: 'Com objeto', objeto: 'Link dedicado', hora_pregao: '15:30' }))
    const sem = await criar(db, opp({ orgao: 'Sem objeto' }))
    const linhas = (await db.query<Record<string, unknown>>(SQL_PENDENTES, [marco])).rows
    expect(linhas.find((l) => l.id === com.id)).toMatchObject({ objeto: 'Link dedicado', hora_pregao: '15:30:00' })
    expect(linhas.find((l) => l.id === sem.id)).toMatchObject({ objeto: null, hora_pregao: null })
  })
  it('o evento do Planner usa objeto e hora quando existem', async () => {
    const com = await criar(db, opp({ orgao: 'SEDES', objeto: 'Link dedicado', hora_pregao: '12:00', data_pregao_dt: '2026-11-05', analista: 'Editor' }))
    const linha = (await db.query<Record<string, unknown>>(SQL_PENDENTES, [marco])).rows.find((l) => l.id === com.id)!
    const e = montarEvento(linha as unknown as OportunidadePlanner, 'oportunidade_nova', mapa, () => null)!
    expect(e.cartao.titulo).toMatch(/^\[RADAR [^\]]+\] .*$/)
    expect(e.cartao.titulo).not.toContain('Link dedicado') // título = sigla + descritivo; o objeto vai nas anotações
    expect(e.cartao.prazo).toBe('2026-11-05T15:00:00Z')
  })
})