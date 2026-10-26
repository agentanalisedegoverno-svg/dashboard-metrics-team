/**
 * Ligação do Planner em tempo real com a API: depois de um Salvar bem-sucedido a API agenda a sincronização (waitUntil) SEM
 * atrasar nem alterar a resposta; sem configuração, ou com o modo "maquina", não faz nada; e qualquer falha da sincronização
 * fica no log e na fila de tentativas, nunca no usuário.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }))
vi.mock('../_lib/access', () => ({
  verifyAccessIdentity: async () => ({ email: 'ana@ctctech.com.br' }),
  verifyAccessJwt: async () => true,
}))

import { agendarAposSalvar, agendarPlanner, plannerNuvemConfigurado, extrasDe } from '../_lib/plannerNuvem.ts'
import { onRequest as listaCriar } from './oportunidades/index.ts'
import { onRequest as porId } from './oportunidades/[id].ts'
import { onRequest as restaurar } from './oportunidades/[id]/restaurar.ts'
import { onRequest as arquivar } from './oportunidades/[id]/arquivar.ts'

const BASE = { DATABASE_URL_APP: 'postgres://app@h/db', CF_ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' }
const PLANNER = { DATABASE_URL_PLANNER: 'postgres://planner@h/db', PLANNER_TENANT_ID: 't', PLANNER_CLIENT_ID: 'c', PLANNER_CLIENT_SECRET: 's' }
const escrita = { 'cf-access-jwt-assertion': 'jwt', 'x-radar-csrf': '1', 'content-type': 'application/json' }

const req = (url: string, method: string, corpo?: unknown) => new Request(`https://radar.test${url}`, { method, headers: escrita, body: corpo ? JSON.stringify(corpo) : undefined })

/** waitUntil que guarda as promessas, para o teste esperar a sincronização terminar (como o runtime faz depois da resposta). */
const novoWaitUntil = () => {
  const promessas: Promise<unknown>[] = []
  return { waitUntil: (p: Promise<unknown>) => void promessas.push(p), esperar: () => Promise.all(promessas), qtd: () => promessas.length }
}

/** Banco falso: as consultas do cadastro respondem normalmente; as do Planner dependem do modo. */
function bancoComModo(modo: 'maquina' | 'nuvem' | 'falha') {
  sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
    const q = strings.join('?').replace(/\s+/g, ' ')
    if (q.includes('criar_oportunidade')) return [{ o: { id: 41, versao: 1, codigo: '2026-0041' } }]
    if (q.includes('atualizar_oportunidade')) return [{ o: { id: 41, versao: 2 } }]
    if (q.includes('arquivar_oportunidade')) return [{ o: { id: 41, versao: 3 } }]
    if (q.includes('from planner_marco')) {
      if (modo === 'falha') throw new Error('Neon indisponível')
      return [{ marco: '2026-10-21T14:00:00Z', modo }]
    }
    return []
  })
}

beforeEach(() => {
  sqlMock.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const chamadasPlanner = () => sqlMock.mock.calls.filter(([s]) => (s as TemplateStringsArray).join('?').includes('planner_'))

describe('configuração', () => {
  it('só considera configurado com banco, tenant, cliente e segredo', () => {
    expect(plannerNuvemConfigurado(PLANNER)).toBe(true)
    for (const campo of Object.keys(PLANNER)) expect(plannerNuvemConfigurado({ ...PLANNER, [campo]: '' }), campo).toBe(false)
    expect(plannerNuvemConfigurado({})).toBe(false)
  })
  it('responsáveis extras: e-mails separados por vírgula, em minúsculas, sem vazios', () => {
    expect(extrasDe({ PLANNER_RESPONSAVEIS_EXTRAS: ' A@x.com, ,b@X.com ' })).toEqual(['a@x.com', 'b@x.com'])
    expect(extrasDe({})).toEqual([])
  })
})

describe('Salvar dispara a sincronização depois da resposta', () => {
  it('criar (201): agenda UMA sincronização com o id criado; a resposta sai igual', async () => {
    bancoComModo('nuvem')
    const w = novoWaitUntil()
    const res = await listaCriar({ request: req('/api/oportunidades', 'POST', { orgao: 'X' }), env: { ...BASE, ...PLANNER }, params: {}, waitUntil: w.waitUntil })
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe(41)
    expect(w.qtd()).toBe(1)
    await w.esperar()
    const consultaModo = chamadasPlanner().find(([s]) => (s as TemplateStringsArray).join('?').includes('from planner_marco'))
    expect(consultaModo).toBeTruthy()
  })

  it('editar (200) e restaurar (200) também agendam; arquivar NÃO', async () => {
    bancoComModo('nuvem')
    const env = { ...BASE, ...PLANNER }
    const a = novoWaitUntil()
    expect((await porId({ request: req('/api/oportunidades/41', 'PUT', { versao: 1, orgao: 'X' }), env, params: { id: '41' }, waitUntil: a.waitUntil })).status).toBe(200)
    expect(a.qtd()).toBe(1)
    const b = novoWaitUntil()
    expect((await restaurar({ request: req('/api/oportunidades/41/restaurar', 'POST'), env, params: { id: '41' }, waitUntil: b.waitUntil })).status).toBe(200)
    expect(b.qtd()).toBe(1)
    const c = novoWaitUntil()
    expect((await arquivar({ request: req('/api/oportunidades/41/arquivar', 'POST'), env, params: { id: '41' }, waitUntil: c.waitUntil })).status).toBe(200)
    expect(c.qtd()).toBe(0)
    await Promise.all([a.esperar(), b.esperar()])
  })

  it('cadastro recusado (422) não agenda nada', async () => {
    bancoComModo('nuvem')
    const w = novoWaitUntil()
    const res = await listaCriar({ request: req('/api/oportunidades', 'POST', { orcamento: 'abc' }), env: { ...BASE, ...PLANNER }, params: {}, waitUntil: w.waitUntil })
    expect(res.status).toBe(422)
    expect(w.qtd()).toBe(0)
  })

  it('sem a configuração do modo nuvem, nada é agendado e o banco do Planner nem é consultado', async () => {
    bancoComModo('nuvem')
    const w = novoWaitUntil()
    const res = await listaCriar({ request: req('/api/oportunidades', 'POST', { orgao: 'X' }), env: BASE, params: {}, waitUntil: w.waitUntil })
    expect(res.status).toBe(201)
    expect(w.qtd()).toBe(0)
    expect(chamadasPlanner()).toHaveLength(0)
  })

  it('sem waitUntil (ambiente de teste ou local) também não faz nada', async () => {
    bancoComModo('nuvem')
    const res = await listaCriar({ request: req('/api/oportunidades', 'POST', { orgao: 'X' }), env: { ...BASE, ...PLANNER }, params: {} })
    expect(res.status).toBe(201)
    expect(chamadasPlanner()).toHaveLength(0)
  })

  it('modo "maquina": a sincronização consulta o interruptor, vê que é da máquina e não chama o Planner', async () => {
    bancoComModo('maquina')
    const w = novoWaitUntil()
    await listaCriar({ request: req('/api/oportunidades', 'POST', { orgao: 'X' }), env: { ...BASE, ...PLANNER }, params: {}, waitUntil: w.waitUntil })
    await w.esperar()
    expect(fetch).not.toHaveBeenCalled() // nem token, nem Graph
    expect(chamadasPlanner().every(([s]) => !(s as TemplateStringsArray).join('?').includes('planner_exportacao'))).toBe(true)
  })

  it('falha da sincronização (banco do Planner fora) não vira erro para o usuário: vai para o log', async () => {
    bancoComModo('falha')
    const w = novoWaitUntil()
    const res = await listaCriar({ request: req('/api/oportunidades', 'POST', { orgao: 'X' }), env: { ...BASE, ...PLANNER }, params: {}, waitUntil: w.waitUntil })
    expect(res.status).toBe(201)
    await expect(w.esperar()).resolves.toBeTruthy() // a promessa agendada NUNCA rejeita
    expect(console.error).toHaveBeenCalledWith('Planner em tempo real:', expect.stringContaining('Neon indisponível'))
  })
})

describe('agendarAposSalvar / agendarPlanner', () => {
  it('ids inválidos não agendam', () => {
    const w = novoWaitUntil()
    for (const id of [undefined, null, 'abc', 0, -1, 1.5, NaN]) agendarPlanner(PLANNER, w.waitUntil, id as never)
    expect(w.qtd()).toBe(0)
  })
  it('resposta com erro não agenda; resposta sem id legível também não', async () => {
    const w = novoWaitUntil()
    await agendarAposSalvar(new Response('{}', { status: 422 }), PLANNER, w.waitUntil)
    await agendarAposSalvar(new Response('texto', { status: 200 }), PLANNER, w.waitUntil)
    expect(w.qtd()).toBe(0)
  })
  it('o log de erro nunca leva o segredo do app', async () => {
    sqlMock.mockRejectedValue(new Error('falhou'))
    const w = novoWaitUntil()
    agendarPlanner({ ...PLANNER, PLANNER_CLIENT_SECRET: 'SEGREDO-NUNCA-NO-LOG' }, w.waitUntil, 7)
    await w.esperar()
    const impresso = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)
    expect(impresso).not.toContain('SEGREDO-NUNCA-NO-LOG')
  })
})
