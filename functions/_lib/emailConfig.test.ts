import { describe, expect, it, vi } from 'vitest'
import type { Sql } from './cadastro.ts'
import { lerEmailConfig, pedirEmailTeste, salvarEmailConfig } from './emailConfig.ts'

const valido = { ativo: true, status: ['Go'], destinatarios: [{ email: ' Ana@CTCTech.com.br ', tipo: 'para', ativo: true }] }

describe('lerEmailConfig', () => {
  it('não-administrador recebe 403 e nada é lido', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ admin: false }]) as unknown as Sql
    const res = await lerEmailConfig(sql, 'x@ctctech.com.br')
    expect(res.status).toBe(403)
    expect(sql).toHaveBeenCalledTimes(1)
  })
  it('administrador recebe regras, destinatários e envios recentes', async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([{ admin: true }])
      .mockResolvedValueOnce([{ ativo: true, status_gatilho: ['Go'], atualizado_por: 'a@x.com', atualizado_em: '2026-10-24T12:00:00Z' }])
      .mockResolvedValueOnce([{ email: 'p@x.com', tipo: 'para', ativo: true }])
      .mockResolvedValueOnce([{ id: 1, tipo: 'nova', situacao: 'enviado' }]) as unknown as Sql
    const res = await lerEmailConfig(sql, 'adm@ctctech.com.br')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ativo: true, status: ['Go'], destinatarios: [{ email: 'p@x.com' }], recentes: [{ id: 1 }] })
  })
})

describe('salvarEmailConfig', () => {
  it('normaliza o e-mail e chama a função do banco com o usuário logado', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as Sql
    const res = await salvarEmailConfig(sql, 'adm@ctctech.com.br', valido)
    expect(res.status).toBe(200)
    const chamada = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(chamada.slice(1)).toEqual([true, ['Go'], JSON.stringify([{ email: 'ana@ctctech.com.br', tipo: 'para', ativo: true }]), 'adm@ctctech.com.br'])
  })
  it('recusa e-mail inválido e excesso de destinatários sem tocar no banco', async () => {
    const sql = vi.fn() as unknown as Sql
    const ruim = await salvarEmailConfig(sql, 'a@x.com', { ...valido, destinatarios: [{ email: 'sem-arroba', tipo: 'para', ativo: true }] })
    expect(ruim.status).toBe(422)
    const muitos = await salvarEmailConfig(sql, 'a@x.com', { ...valido, destinatarios: Array.from({ length: 31 }, (_, i) => ({ email: `u${i}@x.com`, tipo: 'cc', ativo: true })) })
    expect(muitos.status).toBe(422)
    expect(sql).not.toHaveBeenCalled()
  })
  it('tipo diferente de para/cc é recusado', async () => {
    const sql = vi.fn() as unknown as Sql
    const res = await salvarEmailConfig(sql, 'a@x.com', { ...valido, destinatarios: [{ email: 'a@x.com', tipo: 'bcc', ativo: true }] })
    expect(res.status).toBe(422)
  })
  it('erro de permissão do banco vira 403', async () => {
    const sql = vi.fn().mockRejectedValue(Object.assign(new Error('Somente administradores configuram o envio de e-mails'), { code: 'P0403' })) as unknown as Sql
    expect((await salvarEmailConfig(sql, 'x@x.com', valido)).status).toBe(403)
  })
  it('erro de regra do banco vira 422 com a lista de erros', async () => {
    const msg = JSON.stringify([{ campo: 'status', mensagem: 'Marque ao menos um status para ligar o envio' }])
    const sql = vi.fn().mockRejectedValue(Object.assign(new Error(msg), { code: 'P0422' })) as unknown as Sql
    const res = await salvarEmailConfig(sql, 'a@x.com', valido)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ erros: [{ campo: 'status' }] })
  })
})

describe('pedirEmailTeste', () => {
  it('enfileira o teste para o próprio usuário', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as Sql
    expect((await pedirEmailTeste(sql, 'adm@ctctech.com.br')).status).toBe(200)
    expect((sql as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('adm@ctctech.com.br')
  })
})
