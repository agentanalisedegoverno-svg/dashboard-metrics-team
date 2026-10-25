/**
 * Carga e desempenho da camada de API (autenticação, CSRF, validação Zod, serialização, fila de e-mail), com banco e
 * Cloudflare Access simulados com latência: mede o custo do NOSSO código, que é o que a gente controla.
 * (O banco real e a rede são medidos à parte por scripts/medir-banco.mjs.) Rode com `npm run test:carga`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'

const sqlMock = vi.fn()
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }))
vi.mock('../_lib/access', () => ({
  verifyAccessIdentity: async () => {
    await new Promise((r) => setImmediate(r)) // cede o turno do event loop, como a validação real do JWT (setTimeout seria distorcido pelo relógio do Windows)
    return { email: 'carga@ctctech.com.br' }
  },
  verifyAccessJwt: async () => true,
}))

import { oportunidadeInput } from '../../src/domain/oportunidade.ts'
import { processarFila } from '../_lib/emailFila.ts'
import type { Sql } from '../_lib/cadastro.ts'
import { onRequest as listaCriar } from './oportunidades/index.ts'

const FATOR = Number(process.env.BUDGET_FATOR || 1)
const resultados: { teste: string; ms: number; orcamento: number; detalhe: string }[] = []

async function medir<T>(teste: string, orcamentoMs: number, detalhe: (t: number) => string, fn: () => Promise<T>) {
  const t0 = performance.now()
  const r = await fn()
  const ms = performance.now() - t0
  resultados.push({ teste, ms: Math.round(ms), orcamento: orcamentoMs * FATOR, detalhe: detalhe(ms) })
  expect(ms, `${teste}: ${Math.round(ms)} ms (orçamento ${orcamentoMs * FATOR} ms)`).toBeLessThan(orcamentoMs * FATOR)
  return r
}

afterAll(() => {
  let saida = '\n=== Resultados de carga/desempenho (API) ===\n'
  for (const r of resultados) saida += `${r.teste.padEnd(62)} ${String(r.ms).padStart(7)} ms  (orçamento ${String(r.orcamento).padStart(6)} ms)  ${r.detalhe}\n`
  process.stdout.write(saida)
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/carga-api.json', JSON.stringify(resultados, null, 2))
})

const ENV = { DATABASE_URL_APP: 'postgres://app@h/db', CF_ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' }
const req = (method: string, corpo?: unknown) =>
  listaCriar({
    request: new Request('https://radar.test/api/oportunidades', {
      method,
      headers: { 'cf-access-jwt-assertion': 'jwt', 'x-radar-csrf': '1', 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env: ENV,
    params: {},
  })

const linhaGrande = (i: number) => ({
  id: i, codigo: `2026-${String(i).padStart(4, '0')}`, versao: 1, status: 'Go', orgao: `Órgão ${i}`, descritivo: 'Descritivo longo '.repeat(40), processo: `${i}/2026`,
  torre: 'ITS', linha_servico: 'Service Desk', uf: 'DF', analista: 'Marcia', data_pregao_dt: '2026-03-10', orcamento: 1_000_000 + i, valor_ctc: null, impostos: 0.0865,
  pendencias: [], observacoes: 'Observação '.repeat(30), criado_por: 'a@ctctech.com.br', atualizado_por: 'a@ctctech.com.br',
})

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('API sob carga', () => {
  it('1.000 requisições de leitura em sequência (autenticação + CSRF + consulta + resposta)', async () => {
    sqlMock.mockResolvedValue([{ rows: [] }])
    await medir('1.000 leituras sequenciais', 5_000, (t) => `${(t / 1000).toFixed(2)} ms por requisição`, async () => {
      for (let i = 0; i < 1000; i++) expect((await req('GET')).status).toBe(200)
    })
  })

  it('rajada de 500 requisições simultâneas, mistura de leitura e escrita, todas atendidas e corretas', async () => {
    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => (strings.join('?').includes('criar_oportunidade') ? [{ o: { id: 1 } }] : [{ rows: [] }]))
    const resp = await medir('500 requisições simultâneas', 3_000, (t) => `${(t / 500).toFixed(2)} ms por requisição em média`, () =>
      Promise.all(Array.from({ length: 500 }, (_, i) => (i % 5 === 0 ? req('POST', { orgao: `x${i}`, status: 'Go' }) : req('GET')))))
    expect(resp.filter((r) => r.status === 201).length).toBe(100)
    expect(resp.filter((r) => r.status === 200).length).toBe(400)
  })

  it('validação Zod de 20.000 cadastros completos', async () => {
    const payload = { ...linhaGrande(1), descritivo: 'Descritivo '.repeat(100) }
    await medir('20.000 validações do cadastro (Zod)', 5_000, (t) => `${(t / 20000 * 1000).toFixed(0)} µs por validação`, async () => {
      for (let i = 0; i < 20_000; i++) oportunidadeInput.parse(payload)
    })
  })

  it('serialização da listagem de 5.000 oportunidades (resposta de vários MB)', async () => {
    const linhas = Array.from({ length: 5000 }, (_, i) => linhaGrande(i + 1))
    sqlMock.mockResolvedValue([{ rows: linhas }])
    const res = await medir('listagem de 5.000 oportunidades pela API', 1_500, () => '', async () => {
      const r = await req('GET')
      return r.text()
    })
    resultados[resultados.length - 1].detalhe = `${(res.length / 1024 / 1024).toFixed(1)} MB na resposta`
    expect(res.length / 1024 / 1024, 'tamanho da resposta').toBeLessThan(15)
  })

  it('corpo gigante (5 MB de texto) é recusado rápido, sem travar nem chegar ao banco', async () => {
    sqlMock.mockReset().mockResolvedValue([{ o: { id: 1 } }])
    const r = await medir('corpo de 5 MB rejeitado', 1_000, () => '', () => req('POST', { orgao: 'x'.repeat(5_000_000) }))
    expect(r.status).toBe(422)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('fila de e-mail sob carga', () => {
  it('1.000 pedidos pendentes: processa só o lote por rodada e sem estourar tempo', async () => {
    const itens = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, tipo: 'nova', tentativas: 0, destino_teste: null, codigo: `2026-${i}`, orgao: `Órgão ${i}`, status: 'Go', torre: 'ITS', linha_servico: null, uf: 'DF', data_pregao_dt: '2026-03-10', analista: 'Ana', orcamento: 1000, orcamento_sigiloso: false, criado_por: 'a@x.com' }))
    let limiteRecebido = 0
    const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => {
      const q = s.join('?').replace(/\s+/g, ' ')
      if (q.includes('from email_fila f')) {
        limiteRecebido = Number(v[1])
        return itens.slice(0, limiteRecebido)
      }
      if (q.includes('from email_config')) return [{ ativo: true, avisar_pre_vendas: true }]
      if (q.includes('from email_destinatarios')) return [{ email: 'p@x.com', tipo: 'para' }]
      if (q.includes('from usuarios')) return [{ nome: 'Ana', email: 'ana@x.com' }]
      return []
    }) as unknown as Sql
    const enviar = vi.fn(async () => {
      await new Promise((r) => setImmediate(r))
    })
    const r = await medir('lote da fila de e-mail (50 por rodada)', 1_500, (t) => `${(t / 50).toFixed(2)} ms por e-mail`, () => processarFila(sql, enviar, { url: 'https://radar.test' }))
    expect(limiteRecebido).toBe(50)
    expect(r.enviados).toBe(50)
    expect(enviar).toHaveBeenCalledTimes(50)
  })

  it('um e-mail que falha não impede os demais do lote e fica marcado para nova tentativa', async () => {
    const itens = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, tipo: 'nova', tentativas: 0, destino_teste: null, codigo: `c${i}`, orgao: 'O', status: 'Go', torre: null, linha_servico: null, uf: null, data_pregao_dt: null, analista: null, orcamento: null, orcamento_sigiloso: false, criado_por: null }))
    const atualizacoes: string[] = []
    const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => {
      const q = s.join('?').replace(/\s+/g, ' ')
      if (q.includes('from email_fila f')) return itens
      if (q.includes('from email_config')) return [{ ativo: true, avisar_pre_vendas: false }]
      if (q.includes('from email_destinatarios')) return [{ email: 'p@x.com', tipo: 'para' }]
      if (q.startsWith('update email_fila set situacao')) atualizacoes.push(String(v[0]))
      return []
    }) as unknown as Sql
    let n = 0
    const enviar = vi.fn(async () => {
      if (++n % 4 === 0) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    })
    const r = await processarFila(sql, enviar, { url: 'u' })
    expect(r).toMatchObject({ enviados: 15, novaTentativa: 5, falhaDefinitiva: 0 })
    expect(atualizacoes.filter((x) => x === 'pendente').length).toBe(5)
  })
})
