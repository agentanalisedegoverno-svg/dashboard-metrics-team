import { describe, expect, it, vi } from 'vitest'
import { oportunidadeInput } from '../../src/domain/oportunidade.ts'
import { arquivar, atualizar, criar, listar, opcoes } from './cadastro.ts'
import type { ResultadoCnpj } from './cnpj.ts'
import { csrfOk, erroBanco } from './http.ts'

const req = (headers: Record<string, string>, url = 'https://radar.example.com/api/oportunidades') => new Request(url, { method: 'POST', headers })
const pgErr = (code: string, message: string) => Object.assign(new Error(message), { code })
const corpo = async (r: Response) => ({ status: r.status, json: await r.json() })

describe('oportunidadeInput (formato)', () => {
  it('converte vazio em null, vírgula decimal em número e mantém o resto', () => {
    const r = oportunidadeInput.parse({ status: ' ', orgao: 'SEDES', orcamento: '1234,5', mc_ctc: '', posicao_lance: 3, data_pregao_dt: '2026-03-01' })
    expect(r).toMatchObject({ status: null, orgao: 'SEDES', orcamento: 1234.5, mc_ctc: null, posicao_lance: 3, data_pregao_dt: '2026-03-01', orcamento_sigiloso: false, pendencias: [] })
  })
  it.each([
    ['data fora do formato', { data_pregao_dt: '01/03/2026' }, 'data_pregao_dt'],
    ['data impossível', { data_pregao_dt: '2026-02-31' }, 'data_pregao_dt'],
    ['número inválido', { orcamento: 'abc' }, 'orcamento'],
    ['texto longo demais', { orgao: 'x'.repeat(201) }, 'orgao'],
    ['posição fracionada', { posicao_lance: 1.5 }, 'posicao_lance'],
  ])('rejeita %s', (_n, entrada, campo) => {
    const r = oportunidadeInput.safeParse(entrada)
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues[0].path[0]).toBe(campo)
  })
  it('descarta campos desconhecidos (não chegam ao banco)', () => {
    expect(oportunidadeInput.parse({ id: 9, versao: 3, fonte: 'x', arquivado_em: 'agora' })).not.toHaveProperty('fonte')
  })
})

describe('csrfOk', () => {
  it('exige o cabeçalho e aceita Origin do mesmo host', () => {
    expect(csrfOk(req({}))).toBe(false)
    expect(csrfOk(req({ 'x-radar-csrf': '1' }))).toBe(true)
    expect(csrfOk(req({ 'x-radar-csrf': '1', origin: 'https://radar.example.com' }))).toBe(true)
  })
  it('recusa Origin de outro site', () => {
    expect(csrfOk(req({ 'x-radar-csrf': '1', origin: 'https://evil.example' }))).toBe(false)
  })
})

describe('erroBanco', () => {
  it('traduz os SQLSTATE do banco', async () => {
    expect(await corpo(erroBanco(pgErr('P0422', '[{"campo":"status","mensagem":"Campo obrigatório"}]')))).toEqual({
      status: 422,
      json: { error: 'Dados inválidos.', erros: [{ campo: 'status', mensagem: 'Campo obrigatório' }] },
    })
    const conflito = await corpo(erroBanco(pgErr('P0409', '{"versao_atual":4,"atual":{"id":1}}')))
    expect(conflito.status).toBe(409)
    expect(conflito.json).toMatchObject({ versao_atual: 4, atual: { id: 1 } })
    expect((await corpo(erroBanco(pgErr('P0403', 'Somente administradores arquivam ou restauram')))).status).toBe(403)
    expect((await corpo(erroBanco(pgErr('P0404', 'x')))).status).toBe(404)
    expect((await corpo(erroBanco(pgErr('22P02', 'invalid input')))).status).toBe(422)
  })
  it('não vaza detalhes de erros inesperados', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await corpo(erroBanco(pgErr('XX000', 'senha do banco: segredo')))
    expect(r.status).toBe(502)
    expect(JSON.stringify(r.json)).not.toContain('segredo')
  })
})

describe('casos de uso', () => {
  it('criar: valida o formato antes de tocar no banco', async () => {
    const sql = vi.fn()
    const r = await corpo(await criar(sql, 'a@b.com', { orcamento: 'abc' }))
    expect(r.status).toBe(422)
    expect(r.json.erros[0].campo).toBe('orcamento')
    expect(sql).not.toHaveBeenCalled()
  })
  it('criar: devolve 201 com aviso de possível duplicata e envia o e-mail do usuário autenticado', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([{ o: { id: 99, versao: 1 } }])
    const r = await corpo(await criar(sql, 'a@b.com', { processo: '1/2026', orgao: 'SEDES', status: 'Go' }))
    expect(r).toEqual({ status: 201, json: { id: 99, versao: 1, avisos: [{ regra: 'possivel_duplicata', ids: [7] }] } })
    expect(sql.mock.calls[1].slice(1)).toContain('a@b.com')
  })
  it('criar: repassa a validação do banco (422 por campo)', async () => {
    const sql = vi.fn().mockRejectedValue(pgErr('P0422', '[{"campo":"motivo_no_go","mensagem":"Informe o motivo do No Go"}]'))
    const r = await corpo(await criar(sql, 'a@b.com', { status: 'No Go' }))
    expect(r.status).toBe(422)
    expect(r.json.erros[0].campo).toBe('motivo_no_go')
  })
  it('atualizar: exige a versão, rejeita id inválido e devolve 409 em conflito', async () => {
    const sql = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      if (strings.join('').includes('from oportunidades where id')) return [{ cnpj: null, razao: null, tipo: null }]
      throw pgErr('P0409', '{"versao_atual":2,"atual":{}}')
    })
    expect((await corpo(await atualizar(sql, 'a@b.com', 'abc', { versao: 1 }))).status).toBe(404)
    expect((await corpo(await atualizar(sql, 'a@b.com', '5', {}))).status).toBe(422)
    expect((await corpo(await atualizar(sql, 'a@b.com', '5', { versao: 1 }))).status).toBe(409)
  })
  it('arquivar: o banco decide a permissão (403 para não admin)', async () => {
    const sql = vi.fn().mockRejectedValue(pgErr('P0403', 'Somente administradores arquivam ou restauram'))
    expect((await corpo(await arquivar(sql, 'a@b.com', '5', false))).status).toBe(403)
  })
  it('listar: só admin enxerga arquivadas', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ admin: false }]).mockResolvedValueOnce([{ rows: [] }])
    await listar(sql, 'a@b.com', true)
    expect(sql.mock.calls[1][1]).toBe(false)
  })
  it('opcoes: e-mails de usuários só para admin', async () => {
    const dados = [[{ admin: false }], [{ lista: 'torre', valor: 'ITS', ativo: true, ordem: 1 }], [{ linha: 'Lya Gov', torre: 'HEALTH' }], [{ nome: 'Ana', email: 'ana@x.com', admin: false, pre_vendas: true, ativo: true }]]
    const sql = vi.fn().mockImplementation(async () => dados.shift())
    const r = await corpo(await opcoes(sql, 'a@b.com'))
    expect(r.json).toEqual({ listas: { torre: [{ valor: 'ITS', ativo: true, ordem: 1 }] }, preVendas: ['Ana'], linhasTorre: { 'Lya Gov': 'HEALTH' } })
  })
})

describe('empresa vencedora (CNPJ pela Receita)', () => {
  const ok = (tipo: 'Matriz' | 'Filial'): ResultadoCnpj => ({ ok: true, empresa: { cnpj: '00000000000191', razao_social: 'BANCO DO BRASIL SA', tipo, situacao: 'ATIVA', fonte: 'teste' } })
  const base = { status: 'Go', orgao: 'X', descritivo: 'y', torre: 'ITS', data_pregao_dt: '2026-05-05', empresa_vencedora_cnpj: '00.000.000/0001-91' }

  it('criar: preenche razão social e matriz/filial a partir da Receita, ignorando o que veio do navegador', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ o: { id: 5, versao: 1 } }])
    const r = await corpo(await criar(sql, 'a@b.com', { ...base, empresa_vencedora_razao: 'FALSA', empresa_vencedora_tipo: 'Matriz' }, async () => ok('Filial')))
    expect(r.status).toBe(201)
    const enviado = JSON.parse(sql.mock.calls[0][sql.mock.calls[0].length - 2] as string)
    expect(enviado).toMatchObject({ empresa_vencedora_cnpj: '00000000000191', empresa_vencedora_razao: 'BANCO DO BRASIL SA', empresa_vencedora_tipo: 'Filial' })
  })
  it('criar: CNPJ inexistente na Receita vira 422 no campo', async () => {
    const sql = vi.fn()
    const r = await corpo(await criar(sql, 'a@b.com', base, async () => ({ ok: false, motivo: 'nao_encontrado', mensagem: 'CNPJ não encontrado na Receita Federal.' })))
    expect(r.status).toBe(422)
    expect(r.json.erros[0]).toMatchObject({ campo: 'empresa_vencedora_cnpj' })
    expect(sql).not.toHaveBeenCalled()
  })
  it('criar: Receita fora do ar salva só o CNPJ e avisa', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ o: { id: 6, versao: 1 } }])
    const r = await corpo(await criar(sql, 'a@b.com', base, async () => ({ ok: false, motivo: 'indisponivel', mensagem: 'x' })))
    expect(r.status).toBe(201)
    expect(r.json.avisos).toEqual([{ regra: 'cnpj_nao_consultado' }])
  })
  it('atualizar: Receita fora do ar mantém a razão já gravada para o MESMO CNPJ', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ cnpj: '00000000000191', razao: 'BANCO DO BRASIL SA', tipo: 'Matriz' }]).mockResolvedValueOnce([{ o: { id: 1, versao: 2 } }])
    const r = await corpo(await atualizar(sql, 'a@b.com', '1', { ...base, versao: 1 }, async () => ({ ok: false, motivo: 'indisponivel', mensagem: 'x' })))
    expect(r.status).toBe(200)
    expect(r.json.avisos).toEqual([])
    const enviado = JSON.parse(sql.mock.calls[1][sql.mock.calls[1].length - 2] as string)
    expect(enviado.empresa_vencedora_razao).toBe('BANCO DO BRASIL SA')
  })
  it('sem CNPJ, limpa razão e tipo', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ o: { id: 7, versao: 1 } }])
    await criar(sql, 'a@b.com', { ...base, empresa_vencedora_cnpj: '', empresa_vencedora_razao: 'sobra', empresa_vencedora_tipo: 'Matriz' }, async () => ok('Matriz'))
    const enviado = JSON.parse(sql.mock.calls[0][sql.mock.calls[0].length - 2] as string)
    expect(enviado).toMatchObject({ empresa_vencedora_cnpj: null, empresa_vencedora_razao: null, empresa_vencedora_tipo: null })
  })
})
