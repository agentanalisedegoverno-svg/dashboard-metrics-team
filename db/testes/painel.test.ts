/**
 * Consulta do painel (functions/_lib/painel.ts) contra o Postgres real em memória, pelo papel `radar_leitor`.
 *
 * O JSON das linhas agora é montado PELO POSTGRES (o Worker gratuito do Cloudflare tem só 10 ms de CPU e decodificar ~800 linhas
 * ali estourava o teto de vez em quando). Este teste prova que o resultado é IDÊNTICO ao da consulta antiga (decodificada linha a
 * linha e serializada no Worker), inclusive com texto difícil (aspas, barras, acentos, emoji, quebras de linha), números, nulos,
 * jsonb e com os registros que precisam ficar de fora (arquivados, ausentes da planilha e Radar-TIC).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from '../../functions/_lib/cadastro.ts'
import { consultarPainel, consultarStatus, corpoDoPainel } from '../../functions/_lib/painel.ts'
import { DatasetSchema } from '../../src/domain/types.ts'
import { ADMIN, como, criar, criarBanco, opp, type Db } from './banco.ts'

let db: Db

const sqlDe = (d: Db) =>
  ((strings: TemplateStringsArray, ...valores: unknown[]) => d.query(strings.reduce((t, s, i) => t + s + (i < valores.length ? `$${i + 1}` : ''), ''), valores).then((r) => r.rows)) as unknown as Sql

/** A consulta ANTERIOR (cópia fiel), usada só como referência para provar que o resultado não mudou. */
const CONSULTA_ANTIGA = `
  select ano, mes, status, uf, torre, linha_servico as "linhaServico", vistoria, analista,
         motivo_no_go as "motivoNoGo", motivo_lost as "motivoLost", conta_vinculada as "contaVinculada",
         orcamento::float8 as orcamento, valor_ctc::float8 as "valorCtc", valor_vencedor::float8 as "valorVencedor",
         sla::float8 as sla, processo, orgao, descritivo, data_pregao as "dataPregao", acao_ia as "acaoIA"
  from oportunidades where arquivado_em is null and not ausente_na_planilha
    and status is distinct from 'Radar-TIC'
  order by id`
const STATUS_ANTIGO = `select greatest(ultima_carga_em, (select max(atualizado_em) from oportunidades)) as ultima_carga_em from carga_status where id = 1`

const antigo = async () => JSON.parse(JSON.stringify((await db.query(CONSULTA_ANTIGA)).rows)) // como o Worker serializava
const novo = async () => como(db, 'radar_leitor', () => consultarPainel(sqlDe(db)))

beforeAll(async () => {
  db = await criarBanco()
}, 120_000)

describe('consultarPainel: banco vazio', () => {
  it('sem nenhuma oportunidade devolve lista vazia e total 0, sem erro', async () => {
    const p = await novo()
    expect(p.linhas).toBe('[]')
    expect(p.total).toBe(0)
    expect(JSON.parse(corpoDoPainel(p))).toMatchObject({ rows: [], isMock: false })
  })
})

describe('consultarPainel: resultado idêntico ao da consulta antiga', () => {
  let arquivadoId: number
  beforeAll(async () => {
    await criar(db, opp({ status: 'Win', orgao: 'Prefeitura "Municipal" de São José d\'Oeste', descritivo: 'Link\ncom barra \\ e tab\t e emoji 🚀 e acentos ç ã é', uf: 'SP', orcamento: 1_234_567.89, valor_ctc: 1_000_000.5, data_pregao_dt: '2026-03-10' }))
    await criar(db, opp({ status: 'Go', orgao: 'Ministério da Saúde', descritivo: 'Sem valores', uf: 'DF', data_pregao_dt: '2026-08-01' }))
    await criar(db, opp({ status: 'Prospect', orgao: 'Acme', descritivo: 'Valor pequeno', orcamento: 0.1, data_pregao_dt: '2026-09-15' }))
    await criar(db, opp({ status: 'Prospect', orgao: 'Outro', descritivo: 'Ano anterior', data_pregao_dt: '2025-12-01' }))
    const arq = await criar(db, opp({ status: 'Go', orgao: 'Arquivada', descritivo: 'Fora do painel', data_pregao_dt: '2026-01-05' }))
    arquivadoId = arq.id
    await db.query('select arquivar_oportunidade($1::bigint, $2, false)', [arquivadoId, ADMIN])
    const ausente = await criar(db, opp({ status: 'Go', orgao: 'Ausente da planilha', descritivo: 'Legado', data_pregao_dt: '2026-02-02' }))
    await db.query('update oportunidades set ausente_na_planilha = true where id = $1', [ausente.id])
    const radarTic = await criar(db, opp({ status: 'Prospect', orgao: 'Radar-TIC', descritivo: 'Captador', data_pregao_dt: '2026-04-04' }))
    await db.query(`update oportunidades set status = 'Radar-TIC' where id = $1`, [radarTic.id])
    // campos que vêm da planilha antiga e o campo reservado jsonb
    await db.query(`update oportunidades set sla = 12.5, data_pregao = '10/03/2026', acao_ia = '{"sugestao":["a","b"],"n":1,"ok":true,"nulo":null}'::jsonb where orgao like 'Prefeitura%'`)
    await db.query(`update oportunidades set vistoria = 'Sim', conta_vinculada = 'Conta "X"', analista = 'Maria' where orgao = 'Acme'`)
  }, 120_000)

  it('as linhas são exatamente as mesmas, na mesma ordem (comparação profunda do JSON)', async () => {
    const a = await antigo()
    const p = await novo()
    expect(a.length).toBeGreaterThanOrEqual(4)
    expect(JSON.parse(p.linhas)).toEqual(a)
    expect(p.total).toBe(a.length)
  })

  it('deixa de fora arquivados, ausentes da planilha e Radar-TIC', async () => {
    const orgaos = (JSON.parse((await novo()).linhas) as { orgao: string }[]).map((r) => r.orgao)
    expect(orgaos).not.toContain('Arquivada')
    expect(orgaos).not.toContain('Ausente da planilha')
    expect(orgaos).not.toContain('Radar-TIC')
    expect(orgaos).toContain('Ministério da Saúde')
  })

  it('texto difícil, números, nulos e jsonb chegam intactos', async () => {
    const linhas = JSON.parse((await novo()).linhas) as Record<string, any>[]
    const a = linhas.find((r) => String(r.orgao).startsWith('Prefeitura'))!
    expect(a.orgao).toBe('Prefeitura "Municipal" de São José d\'Oeste')
    expect(a.descritivo).toBe('Link\ncom barra \\ e tab\t e emoji 🚀 e acentos ç ã é')
    expect(a).toMatchObject({ orcamento: 1_234_567.89, valorCtc: 1_000_000.5, sla: 12.5, dataPregao: '10/03/2026', acaoIA: { sugestao: ['a', 'b'], n: 1, ok: true, nulo: null } })
    const semValores = linhas.find((r) => r.orgao === 'Ministério da Saúde')!
    expect(semValores.orcamento).toBeNull()
    expect(semValores.valorVencedor).toBeNull()
    expect(linhas.find((r) => r.orgao === 'Acme')).toMatchObject({ orcamento: 0.1, vistoria: 'Sim', contaVinculada: 'Conta "X"', analista: 'Maria' })
  })

  it('cada linha tem exatamente as chaves do contrato do painel (e nenhuma chave de apoio, como "ord")', async () => {
    const [primeira] = JSON.parse((await novo()).linhas) as Record<string, unknown>[]
    expect(Object.keys(primeira).sort()).toEqual(
      ['acaoIA', 'analista', 'ano', 'contaVinculada', 'dataPregao', 'descritivo', 'linhaServico', 'mes', 'motivoLost', 'motivoNoGo', 'orcamento', 'orgao', 'processo', 'sla', 'status', 'torre', 'uf', 'valorCtc', 'valorVencedor', 'vistoria'].sort(),
    )
  })

  it('o corpo de /api/rows é um JSON válido que o front aceita (DatasetSchema)', async () => {
    const corpo = JSON.parse(corpoDoPainel(await novo())) as { rows: unknown; updatedAt: string | null; isMock: boolean }
    expect(corpo.isMock).toBe(false)
    expect(DatasetSchema.safeParse(corpo.rows).success).toBe(true)
  })
})

describe('consultarPainel: data da última atualização', () => {
  it('sem data de carga e sem data de alteração anterior, usa a maior entre a carga e a última alteração (mesmo formato ISO de antes)', async () => {
    await db.query('update carga_status set ultima_carga_em = null where id = 1')
    const antes = await db.query<{ ultima_carga_em: Date | null }>(STATUS_ANTIGO)
    const p = await novo()
    expect(p.atualizado_em).toBe(antes.rows[0].ultima_carga_em ? antes.rows[0].ultima_carga_em.toISOString() : null)
  })

  it('carga mais nova que a última alteração: vale a carga, com milissegundos', async () => {
    await db.query(`update carga_status set ultima_carga_em = '2099-10-11T00:08:41.960Z' where id = 1`)
    const p = await novo()
    expect(p.atualizado_em).toBe('2099-10-11T00:08:41.960Z')
    expect(corpoDoPainel(p)).toContain('"updatedAt":"2099-10-11T00:08:41.960Z"')
  })

  it('sem a linha de carga_status o painel continua funcionando e a data é nula (como antes)', async () => {
    await db.query('delete from carga_status')
    const p = await novo()
    expect(p.atualizado_em).toBeNull()
    expect(JSON.parse(p.linhas).length).toBe(p.total)
    expect(corpoDoPainel(p)).toContain('"updatedAt":null')
    await db.query('insert into carga_status (id) values (1)')
  })
})

describe('consultarPainel: segurança', () => {
  it('roda pelo papel radar_leitor (só SELECT) e esse papel continua sem conseguir gravar', async () => {
    await como(db, 'radar_leitor', async () => {
      await expect(consultarPainel(sqlDe(db))).resolves.toBeTruthy()
      await expect(consultarStatus(sqlDe(db))).resolves.toBeTruthy()
      await expect(db.query(`update oportunidades set orgao = 'x'`)).rejects.toThrow()
    })
  })

  it('a consulta nova só lê (nenhum comando de escrita no SQL)', async () => {
    const capturado: string[] = []
    const espia = ((strings: TemplateStringsArray) => {
      capturado.push(strings.join('?'))
      return Promise.resolve([{ atualizado_em: null, total: 0, linhas: '[]' }])
    }) as unknown as Sql
    await consultarPainel(espia)
    expect(capturado).toHaveLength(1)
    expect(capturado[0].toLowerCase()).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|create)\b/)
  })

  it('resposta inesperada do banco vira erro (nunca um JSON quebrado para o painel)', async () => {
    const quebrado = (() => Promise.resolve([{ atualizado_em: null, total: 1, linhas: null }])) as unknown as Sql
    await expect(consultarPainel(quebrado)).rejects.toThrow(/inesperada/)
    const vazio = (() => Promise.resolve([])) as unknown as Sql
    await expect(consultarPainel(vazio)).rejects.toThrow(/inesperada/)
  })
})
