/**
 * Carga e desempenho do banco (Postgres em memória, criado do zero com as migrações). Não roda no `npm test`:
 * use `npm run test:carga`. Mede o custo das regras (gatilhos, validação, código, histórico, fila de e-mail) com volume
 * muito acima do real (hoje ~650 oportunidades; aqui, milhares) e falha se algum tempo estourar o orçamento.
 * Os orçamentos têm folga para variação da máquina; BUDGET_FATOR=2 dobra todos (CI lento).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, criar, criarBanco, opp, type Db } from './banco.ts'

const FATOR = Number(process.env.BUDGET_FATOR || 1)
const resultados: { teste: string; ms: number; orcamento: number; detalhe: string }[] = []

async function medir<T>(teste: string, orcamentoMs: number, detalhe: (t: number, r: T) => string, fn: () => Promise<T>) {
  const t0 = performance.now()
  const r = await fn()
  const ms = performance.now() - t0
  resultados.push({ teste, ms: Math.round(ms), orcamento: orcamentoMs * FATOR, detalhe: detalhe(ms, r) })
  expect(ms, `${teste}: ${Math.round(ms)} ms (orçamento ${orcamentoMs * FATOR} ms)`).toBeLessThan(orcamentoMs * FATOR)
  return r
}

let db: Db
const N = 2000
beforeAll(async () => {
  db = await criarBanco()
  await db.query(`select salvar_email_config(true, ARRAY['Go'], '[{"email":"a@x.com"}]'::jsonb, $1, true)`, [ADMIN])
}, 120_000)

afterAll(() => {
  // process.stdout.write: o vitest esconde console.log de ganchos; a tabela precisa aparecer no terminal e no CI.
  let saida = '\n=== Resultados de carga/desempenho (banco) ===\n'
  for (const r of resultados) saida += `${r.teste.padEnd(62)} ${String(r.ms).padStart(7)} ms  (orçamento ${String(r.orcamento).padStart(6)} ms)  ${r.detalhe}\n`
  process.stdout.write(saida)
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/carga-banco.json', JSON.stringify(resultados, null, 2))
})

describe('escrita sob volume', () => {
  it(`${N} cadastros pela web (validação + código + torre + histórico + fila de e-mail)`, async () => {
    await medir(`${N} cadastros sequenciais`, 25_000, (t) => `${(t / N).toFixed(1)} ms por cadastro`, async () => {
      for (let i = 0; i < N; i++) {
        await criar(db, opp({ orgao: `Órgão ${i}`, data_pregao_dt: `2051-${String((i % 12) + 1).padStart(2, '0')}-10`, impostos: 0.0865, mc_ctc: 0.18 }))
      }
    })
    const r = await db.query<{ total: string; distintos: string; fila: string; hist: string }>(`
      select count(*)::text total, count(distinct codigo)::text distintos,
             (select count(*)::text from email_fila) fila, (select count(*)::text from oportunidades_historico) hist
      from oportunidades where fonte = 'web'`)
    expect(r.rows[0].total).toBe(String(N))
    expect(r.rows[0].distintos, 'códigos AAAA-NNNN duplicados').toBe(String(N))
    expect(r.rows[0].fila, 'um pedido de e-mail por oportunidade').toBe(String(N))
    expect(Number(r.rows[0].hist)).toBeGreaterThanOrEqual(N)
  }, 300_000)

  it('o código é contínuo por ano (2051-0001 a 2051-2000), sem buracos', async () => {
    const r = await db.query<{ n: string; max: string }>(`select count(*)::text n, max(codigo) max from oportunidades where codigo like '2051-%'`)
    expect(r.rows[0]).toEqual({ n: String(N), max: `2051-${N}` })
  })

  it('200 cadastros disparados ao mesmo tempo não repetem código nem perdem registro', async () => {
    const antes = Number((await db.query<{ n: string }>(`select count(*)::text n from oportunidades`)).rows[0].n)
    await medir('200 cadastros concorrentes', 6_000, (t) => `${(t / 200).toFixed(1)} ms por cadastro`, () =>
      Promise.all(Array.from({ length: 200 }, (_, i) => criar(db, opp({ orgao: `Concorrente ${i}`, data_pregao_dt: '2052-03-10' })))))
    const r = await db.query<{ n: string; distintos: string }>(`select count(*)::text n, count(distinct codigo)::text distintos from oportunidades where codigo like '2052-%'`)
    expect(r.rows[0]).toEqual({ n: '200', distintos: '200' })
    expect(Number((await db.query<{ n: string }>(`select count(*)::text n from oportunidades`)).rows[0].n)).toBe(antes + 200)
  }, 120_000)
})

describe('leitura sob volume', () => {
  it('listagem completa como a API faz (todas as linhas em JSON)', async () => {
    const tempos: number[] = []
    let bytes = 0
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now()
      const r = await db.query<{ rows: unknown[] }>(`select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb) as rows from oportunidades o where o.arquivado_em is null`)
      tempos.push(performance.now() - t0)
      bytes = JSON.stringify(r.rows[0].rows).length
    }
    tempos.sort((a, b) => a - b)
    const p95 = tempos[Math.floor(tempos.length * 0.95) - 1] ?? tempos.at(-1)!
    resultados.push({ teste: `listagem de ${N + 200}+ linhas (p95 de 15)`, ms: Math.round(p95), orcamento: 2000 * FATOR, detalhe: `${(bytes / 1024 / 1024).toFixed(1)} MB de JSON` })
    expect(p95).toBeLessThan(2000 * FATOR)
    expect(bytes / 1024 / 1024, 'tamanho da resposta da listagem').toBeLessThan(25)
  }, 120_000)

  it('consultas filtradas e agregadas usadas pelo painel', async () => {
    await medir('agregações do painel (por status, torre e mês)', 1000, () => '', async () => {
      await db.query(`select status, count(*), sum(orcamento) from oportunidades group by 1`)
      await db.query(`select torre, count(*) from oportunidades group by 1`)
      await db.query(`select mes, count(*) from oportunidades group by 1 order by 1`)
    })
  })

  it('busca de uma oportunidade pelo código (índice único)', async () => {
    const plano = await db.query<{ 'QUERY PLAN': string }>(`explain select * from oportunidades where codigo = '2051-0100'`)
    const texto = plano.rows.map((r) => r['QUERY PLAN']).join('\n')
    expect(texto, 'a busca por código deve usar o índice').toMatch(/oportunidades_codigo_uq|Index/i)
  })
})

describe('histórico e fila', () => {
  it('300 edições seguidas na mesma oportunidade: histórico completo e leitura rápida', async () => {
    const o = await criar(db, opp({ orgao: 'Muito editada', data_pregao_dt: '2053-01-10', status: 'Prospect' }))
    let versao = o.versao as number
    await medir('300 edições de uma oportunidade', 8_000, (t) => `${(t / 300).toFixed(1)} ms por edição`, async () => {
      for (let i = 0; i < 300; i++) {
        const r = await db.query<{ o: { versao: number } }>('select atualizar_oportunidade($1::bigint, $2::int, $3::jsonb, $4) as o', [o.id, versao, JSON.stringify(opp({ status: 'Prospect', orgao: 'Muito editada', observacoes: `edição ${i}` })), ADMIN])
        versao = r.rows[0].o.versao
      }
    })
    await medir('leitura do histórico (300 alterações)', 500, () => '', () =>
      db.query(`select * from oportunidades_historico where oportunidade_id = $1 order by em desc, id desc`, [o.id]))
    const h = await db.query<{ n: string }>(`select count(*)::text n from oportunidades_historico where oportunidade_id = $1`, [o.id])
    expect(h.rows[0].n).toBe('301')
  }, 120_000)
})

describe('carga da planilha', () => {
  const linhas = (n: number, sufixo = '') =>
    Array.from({ length: n }, (_, i) => ({
      chave_planilha: `carga-${i}`, status: i % 2 ? 'Go' : 'No Go', motivo_no_go: i % 2 ? null : 'Risco', orgao: `Planilha ${i}${sufixo}`, descritivo: 'Descrição '.repeat(10),
      torre: 'ITS', data_pregao_dt: '2054-05-10', orcamento: 1000 + i, linha_servico: 'Service Desk', modalidade: 'Pregão', site: 'ComprasNet',
    }))
  const sync = async (rows: unknown[]) => (await db.query<{ r: Record<string, number> }>(`select sincronizar_planilha($1::jsonb, 'carga', false) as r`, [JSON.stringify(rows)])).rows[0].r

  it('3.000 linhas: inserção, repetição sem mudanças e atualização parcial', async () => {
    await db.query(`insert into opcoes (lista, valor) values ('motivo_no_go','Risco') on conflict do nothing`)
    const r1 = await medir('carga de 3.000 linhas (tudo novo)', 8_000, () => '', () => sync(linhas(3000)))
    expect(r1).toMatchObject({ recebidas: 3000, inseridas: 3000 })
    const r2 = await medir('mesma carga de novo (nada mudou)', 8_000, () => '', () => sync(linhas(3000)))
    expect(r2).toMatchObject({ inseridas: 0, atualizadas: 0 })
    const parcial = linhas(3000).map((l, i) => (i < 300 ? { ...l, orgao: `${l.orgao} (alterado)` } : l))
    const r3 = await medir('carga com 300 linhas alteradas', 10_000, () => '', () => sync(parcial))
    expect(r3).toMatchObject({ atualizadas: 300, inseridas: 0 })
  }, 300_000)
})
