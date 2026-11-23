import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sql } from './cadastro.ts'
import { argumentosParaUrl, FERRAMENTAS, LIMITE_MAXIMO, LIMITE_PADRAO, tratarMcp, tratarMensagem, VERSOES } from './mcpRemoto.ts'

const leitor = vi.fn()
const sql = leitor as unknown as Sql
const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params })
const chamar = async (corpo: unknown) => {
  const r = await tratarMcp(corpo, sql)
  return { status: r.status, corpo: r.status === 202 ? null : await r.json() }
}
const ferramenta = async (name: string, args: unknown = {}) => {
  const { corpo } = await chamar(rpc('tools/call', { name, arguments: args }))
  return corpo.result as { isError?: boolean; content: { text: string }[] }
}

beforeEach(() => {
  leitor.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('MCP remoto: protocolo', () => {
  it('initialize devolve a versão do cliente quando a conhece, ou a mais nova; só declara ferramentas', async () => {
    const a = await chamar(rpc('initialize', { protocolVersion: '2025-03-26' }))
    expect(a.corpo.result.protocolVersion).toBe('2025-03-26')
    expect(a.corpo.result.serverInfo.name).toBe('radar-prevendas')
    expect(Object.keys(a.corpo.result.capabilities)).toEqual(['tools'])
    const b = await chamar(rpc('initialize', { protocolVersion: '1999-01-01' }))
    expect(b.corpo.result.protocolVersion).toBe(VERSOES[0])
    expect(leitor).not.toHaveBeenCalled()
  })

  it('notificações e respostas do cliente não geram retorno (202 sem corpo)', async () => {
    expect((await chamar({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    expect((await chamar({ jsonrpc: '2.0', id: 5, result: {} })).status).toBe(202)
  })

  it('ping responde vazio e método desconhecido vira erro JSON-RPC', async () => {
    expect((await chamar(rpc('ping'))).corpo.result).toEqual({})
    expect((await chamar(rpc('resources/list'))).corpo.error.code).toBe(-32601)
    expect((await chamar(rpc('prompts/get'))).corpo.error.code).toBe(-32601)
  })

  it('mensagem malformada é recusada sem tocar no banco', async () => {
    for (const ruim of [null, 5, 'x', { id: 1 }, { jsonrpc: '1.0', id: 1, method: 'ping' }]) {
      const r = await tratarMensagem(ruim, sql)
      expect(r?.error?.code).toBe(-32600)
    }
    expect((await chamar([])).corpo.error.code).toBe(-32600)
    expect((await chamar(Array.from({ length: 21 }, () => rpc('ping')))).corpo.error.code).toBe(-32600)
    expect(leitor).not.toHaveBeenCalled()
  })

  it('lote devolve uma resposta por requisição (notificações ficam de fora)', async () => {
    const r = await chamar([rpc('ping', undefined, 1), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc('tools/list', undefined, 'b')])
    expect(r.corpo.map((x: { id: unknown }) => x.id)).toEqual([1, 'b'])
  })
})

describe('MCP remoto: ferramentas só de leitura', () => {
  it('expõe exatamente as 3 ferramentas, todas marcadas como somente leitura', async () => {
    const { corpo } = await chamar(rpc('tools/list'))
    expect(corpo.result.tools.map((t: { name: string }) => t.name)).toEqual(['listar_oportunidades', 'ver_oportunidade', 'listar_campos'])
    for (const t of FERRAMENTAS) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(JSON.stringify(FERRAMENTAS)).not.toMatch(/criar|atualizar|apagar|excluir|arquivar/i)
  })

  it('ferramenta desconhecida é erro de parâmetro', async () => {
    const { corpo } = await chamar(rpc('tools/call', { name: 'criar_oportunidade', arguments: {} }))
    expect(corpo.error.code).toBe(-32602)
    expect(leitor).not.toHaveBeenCalled()
  })

  it('listar: página padrão de 25, teto de 100, filtros viram parâmetros vinculados', async () => {
    leitor.mockResolvedValue([{ total: 2, itens: [{ id: 1, valor_ctc: 5 }, { id: 2 }] }])
    const r = await ferramenta('listar_oportunidades', { status: 'Go', valor_min: 1000000, arquivadas: true })
    expect(JSON.parse(r.content[0].text)).toMatchObject({ total: 2, retornadas: 2, offset: 0, proximo_offset: null, itens: [{ id: 1, valor_ctc: 5 }, { id: 2 }] })
    const [strings, ...valores] = leitor.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    expect(valores.slice(-2)).toEqual([LIMITE_PADRAO, 0])
    expect(valores).toContain('Go')
    expect(strings.join('?').toLowerCase()).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/)
    leitor.mockClear()
    await ferramenta('listar_oportunidades', { limite: 5000, offset: 50 })
    expect((leitor.mock.calls[0] as unknown[]).slice(-2)).toEqual([LIMITE_MAXIMO, 50])
  })

  it('limite inválido volta ao padrão; argumento desconhecido ou texto longo é recusado sem consultar o banco', async () => {
    expect(argumentosParaUrl({ limite: 0 }).searchParams.get('limite')).toBe('1')
    expect(argumentosParaUrl({ limite: 7.5 }).searchParams.get('limite')).toBe(String(LIMITE_PADRAO))
    expect(argumentosParaUrl({ limite: 'x' }).searchParams.get('limite')).toBe(String(LIMITE_PADRAO))
    const desconhecido = await ferramenta('listar_oportunidades', { statos: 'Go' })
    expect(desconhecido.isError).toBe(true)
    expect(desconhecido.content[0].text).toMatch(/statos: Parâmetro desconhecido/)
    const longo = await ferramenta('listar_oportunidades', { q: 'a'.repeat(101) })
    expect(longo.isError).toBe(true)
    const objeto = await ferramenta('listar_oportunidades', { status: { $ne: 1 } })
    expect(objeto.isError).toBe(true)
    expect(leitor).not.toHaveBeenCalled()
  })

  it('ver: código ou id válidos consultam; qualquer outra coisa é recusada antes do banco', async () => {
    leitor.mockResolvedValueOnce([{ r: { id: 7, codigo: '2026-0007', custo: 10 } }]).mockResolvedValueOnce([])
    const ok = await ferramenta('ver_oportunidade', { codigo: ' 2026-0007 ' })
    expect(JSON.parse(ok.content[0].text)).toMatchObject({ codigo: '2026-0007', custo: 10 })
    const naoAchou = await ferramenta('ver_oportunidade', { codigo: '2026-0099' })
    expect(naoAchou.isError).toBe(true)
    expect(naoAchou.content[0].text).toMatch(/não encontrada/)
    leitor.mockClear()
    for (const codigo of ["1'; drop table x;--", '../../etc/passwd', '2026-', 'abc', '', '2026-0001/historico', 5, null, undefined]) {
      expect((await ferramenta('ver_oportunidade', { codigo })).isError, String(codigo)).toBe(true)
    }
    expect((await ferramenta('ver_oportunidade')).isError).toBe(true)
    expect(leitor).not.toHaveBeenCalled()
  })

  it('campos: catálogo vem do papel de leitura', async () => {
    leitor.mockResolvedValue([{ lista: 'status', valor: 'Go', ativo: true }])
    const r = await ferramenta('listar_campos')
    const j = JSON.parse(r.content[0].text)
    expect(Array.isArray(j.campos)).toBe(true)
    expect(j.regras).toBeDefined()
    expect(leitor).toHaveBeenCalledTimes(1)
  })

  it('falha no banco vira mensagem genérica, sem vazar o erro interno', async () => {
    leitor.mockRejectedValue(new Error('password authentication failed for user "radar_leitor" host=db.interno'))
    const r = await ferramenta('listar_oportunidades')
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r)).not.toMatch(/radar_leitor|password|db\.interno/)
  })
})
