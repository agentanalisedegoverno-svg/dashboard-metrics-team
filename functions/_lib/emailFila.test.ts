import { describe, expect, it, vi } from 'vitest'
import type { Sql } from './cadastro.ts'
import { processarFila, resumoErro } from './emailFila.ts'

const item = (extra: Record<string, unknown> = {}) => ({
  id: 1, tipo: 'nova', tentativas: 0, destino_teste: null, codigo: '2026-0001', orgao: 'Órgão X', status: 'Go', torre: 'ITS', linha_servico: null, uf: 'SP',
  data_pregao_dt: '2026-11-05', analista: 'Ana', orcamento: 1000, orcamento_sigiloso: false, criado_por: 'a@ctctech.com.br', ...extra,
})

function fake(itens: unknown[], opc: { jaPegos?: number[]; ativo?: boolean; avisar?: boolean; dest?: { email: string; tipo: string }[]; usuarios?: { nome: string; email: string }[] } = {}) {
  const updates: { q: string; v: unknown[] }[] = []
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = s.join('?').replace(/\s+/g, ' ')
    if (q.includes('from email_fila f')) return itens
    if (q.includes('returning id')) {
      updates.push({ q, v })
      return opc.jaPegos?.includes(Number(v[0])) ? [] : [{ id: v[0] }]
    }
    if (q.includes('from email_config')) return [{ ativo: opc.ativo ?? true, avisar_pre_vendas: opc.avisar ?? false }]
    if (q.includes('from usuarios')) return opc.usuarios ?? []
    if (q.includes('from email_destinatarios')) return opc.dest ?? [{ email: 'p@x.com', tipo: 'para' }, { email: 'c@x.com', tipo: 'cc' }]
    updates.push({ q, v })
    return []
  }) as unknown as Sql
  return { sql, updates }
}

describe('processarFila', () => {
  it('avisa cada pré-vendas da oportunidade (sem repetir quem já é destinatário)', async () => {
    const usuarios = [{ nome: 'Ana', email: 'ana@x.com' }, { nome: 'Bia', email: 'bia@x.com' }, { nome: 'Caio', email: 'p@x.com' }]
    const { sql } = fake([item({ analista: 'Ana, Bia, Caio' })], { avisar: true, usuarios })
    const enviar = vi.fn().mockResolvedValue(undefined)
    await processarFila(sql, enviar, { url: 'https://radar.test' })
    expect(enviar.mock.calls[0][0].to).toEqual(['p@x.com', 'ana@x.com', 'bia@x.com'])
  })
  it('envia para os destinatários ativos e marca como enviado', async () => {
    const { sql, updates } = fake([item()])
    const enviar = vi.fn().mockResolvedValue(undefined)
    const r = await processarFila(sql, enviar, { url: 'https://radar.test' })
    expect(r).toMatchObject({ pendentes: 1, enviados: 1, ignorados: 0 })
    expect(enviar.mock.calls[0][0]).toMatchObject({ to: ['p@x.com'], cc: ['c@x.com'] })
    expect(enviar.mock.calls[0][0].assunto).toContain('2026-0001')
    expect(updates.some((u) => u.q.includes("situacao = 'enviado'"))).toBe(true)
  })
  it('envio desligado depois de entrar na fila: ignora sem enviar', async () => {
    const { sql } = fake([item()], { ativo: false })
    const enviar = vi.fn()
    expect(await processarFila(sql, enviar, { url: 'u' })).toMatchObject({ ignorados: 1, enviados: 0 })
    expect(enviar).not.toHaveBeenCalled()
  })
  it('sem destinatário "para": ignora', async () => {
    const { sql } = fake([item()], { dest: [{ email: 'c@x.com', tipo: 'cc' }] })
    const enviar = vi.fn()
    expect(await processarFila(sql, enviar, { url: 'u' })).toMatchObject({ ignorados: 1 })
    expect(enviar).not.toHaveBeenCalled()
  })
  it('falha volta para pendente; na última tentativa vira erro', async () => {
    const enviar = vi.fn().mockRejectedValue(Object.assign(new Error('Invalid login for joao@x.com'), { code: 'EAUTH', responseCode: 535 }))
    const a = fake([item({ tentativas: 1 })])
    expect(await processarFila(a.sql, enviar, { url: 'u' })).toMatchObject({ novaTentativa: 1, falhaDefinitiva: 0 })
    const ultimoA = a.updates.at(-1)!
    expect(ultimoA.v[0]).toBe('pendente')
    expect(String(ultimoA.v[1])).not.toContain('joao@x.com')
    const b = fake([item({ tentativas: 4 })])
    expect(await processarFila(b.sql, enviar, { url: 'u' })).toMatchObject({ falhaDefinitiva: 1 })
    expect(b.updates.at(-1)!.v[0]).toBe('erro')
  })
  it('teste vai só para quem pediu, mesmo com o módulo desligado', async () => {
    const { sql } = fake([item({ tipo: 'teste', codigo: null, destino_teste: 'admin@ctctech.com.br' })], { ativo: false })
    const enviar = vi.fn().mockResolvedValue(undefined)
    expect(await processarFila(sql, enviar, { url: 'u' })).toMatchObject({ enviados: 1 })
    expect(enviar.mock.calls[0][0]).toMatchObject({ to: ['admin@ctctech.com.br'], cc: [], assunto: '[Radar] E-mail de teste' })
  })
  it('simular não envia nem grava', async () => {
    const { sql, updates } = fake([item()])
    const enviar = vi.fn()
    expect(await processarFila(sql, enviar, { url: 'u', simular: true })).toMatchObject({ enviados: 1 })
    expect(enviar).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })
  it('fila vazia não consulta regras', async () => {
    const { sql } = fake([])
    expect(await processarFila(sql, vi.fn(), { url: 'u' })).toMatchObject({ pendentes: 0 })
  })
})

describe('dois processos ao mesmo tempo (máquina do time e GitHub)', () => {
  it('quem não consegue "pegar" o pedido pula: o e-mail nunca sai em dobro', async () => {
    const { sql } = fake([item({ id: 1 }), item({ id: 2 })], { jaPegos: [1] }) // o pedido 1 já foi pego por outro processo
    const enviar = vi.fn().mockResolvedValue(undefined)
    const r = await processarFila(sql, enviar, { url: 'u' })
    expect(enviar).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ enviados: 1, emOutroProcesso: 1 })
  })
  it('a "pegada" confere a situação e o número de tentativas lido (só ganha quem viu o mesmo estado)', async () => {
    const { sql, updates } = fake([item({ id: 5, tentativas: 2 })])
    await processarFila(sql, vi.fn().mockResolvedValue(undefined), { url: 'u' })
    const pegada = updates.find((u) => u.q.includes('returning id'))!
    expect(pegada.q).toContain("situacao = 'pendente'")
    expect(pegada.q).toContain('tentativas = ')
    expect(pegada.v).toEqual([5, 2])
  })
})

describe('avisar o pré-vendas da oportunidade', () => {
  const usuarios = [{ nome: 'Ana', email: 'Ana@ctctech.com.br' }]
  it('liga: o pré-vendas entra em Para, junto da lista', async () => {
    const { sql } = fake([item({ analista: 'Ana' })], { avisar: true, usuarios })
    const enviar = vi.fn().mockResolvedValue(undefined)
    await processarFila(sql, enviar, { url: 'u' })
    expect(enviar.mock.calls[0][0]).toMatchObject({ to: ['p@x.com', 'ana@ctctech.com.br'], cc: ['c@x.com'] })
  })
  it('desligado: o pré-vendas não recebe', async () => {
    const { sql } = fake([item({ analista: 'Ana' })], { avisar: false, usuarios })
    const enviar = vi.fn().mockResolvedValue(undefined)
    await processarFila(sql, enviar, { url: 'u' })
    expect(enviar.mock.calls[0][0].to).toEqual(['p@x.com'])
  })
  it('sem duplicar quem já está na lista (para ou cópia)', async () => {
    const dest = [{ email: 'ana@ctctech.com.br', tipo: 'cc' }, { email: 'p@x.com', tipo: 'para' }]
    const { sql } = fake([item({ analista: 'Ana' })], { avisar: true, usuarios, dest })
    const enviar = vi.fn().mockResolvedValue(undefined)
    await processarFila(sql, enviar, { url: 'u' })
    expect(enviar.mock.calls[0][0]).toMatchObject({ to: ['p@x.com'], cc: ['ana@ctctech.com.br'] })
  })
  it('pré-vendas sem e-mail cadastrado ou sem nome na oportunidade: segue só com a lista', async () => {
    const { sql } = fake([item({ analista: 'Sem Email' }), item({ id: 2, analista: null })], { avisar: true, usuarios })
    const enviar = vi.fn().mockResolvedValue(undefined)
    await processarFila(sql, enviar, { url: 'u' })
    expect(enviar.mock.calls.map((c) => c[0].to)).toEqual([['p@x.com'], ['p@x.com']])
  })
  it('lista vazia, mas com o aviso ao pré-vendas: envia só para ele; sem pré-vendas, ignora', async () => {
    const { sql } = fake([item({ analista: 'Ana' }), item({ id: 2, analista: null })], { avisar: true, usuarios, dest: [] })
    const enviar = vi.fn().mockResolvedValue(undefined)
    expect(await processarFila(sql, enviar, { url: 'u' })).toMatchObject({ enviados: 1, ignorados: 1 })
    expect(enviar.mock.calls[0][0].to).toEqual(['ana@ctctech.com.br'])
  })
  it('e-mail de teste nunca vai ao pré-vendas', async () => {
    const { sql } = fake([item({ tipo: 'teste', destino_teste: 'adm@ctctech.com.br', analista: 'Ana' })], { avisar: true, usuarios })
    const enviar = vi.fn().mockResolvedValue(undefined)
    await processarFila(sql, enviar, { url: 'u' })
    expect(enviar.mock.calls[0][0].to).toEqual(['adm@ctctech.com.br'])
  })
})

describe('resumoErro', () => {
  it('remove e-mails da mensagem', () => {
    expect(resumoErro(new Error('rejeitado: a.b@c.com'))).not.toContain('a.b@c.com')
  })
})
