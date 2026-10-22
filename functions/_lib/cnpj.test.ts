import { describe, expect, it, vi } from 'vitest'
import { consultaCnpj } from './cnpj.ts'

const json = (status: number, corpo: unknown = {}) => new Response(JSON.stringify(corpo), { status })
/** Responde conforme o host da URL; o que não estiver no mapa falha como rede. */
const porHost = (mapa: Record<string, Response | Error>) =>
  vi.fn(async (url: string | URL | Request) => {
    const host = new URL(String(url)).host
    const r = mapa[host]
    if (!r) throw new Error('sem rota')
    if (r instanceof Error) throw r
    return r.clone()
  }) as unknown as typeof fetch

const BB = { razao_social: ' BANCO DO BRASIL SA ', identificador_matriz_filial: 1, descricao_situacao_cadastral: 'ATIVA' }

describe('consultaCnpj (várias fontes públicas da Receita)', () => {
  it('matriz pela primeira fonte', async () => {
    const f = porHost({ 'brasilapi.com.br': json(200, BB) })
    const r = await consultaCnpj('00.000.000/0001-91', f)
    expect(r).toEqual({ ok: true, empresa: { cnpj: '00000000000191', razao_social: 'BANCO DO BRASIL SA', tipo: 'Matriz', situacao: 'ATIVA', fonte: 'brasilapi' } })
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })
  it('filial (por identificador ou descrição)', async () => {
    const a = await consultaCnpj('00000000000191', porHost({ 'brasilapi.com.br': json(200, { razao_social: 'X', identificador_matriz_filial: 2 }) }))
    const b = await consultaCnpj('00000000000191', porHost({ 'brasilapi.com.br': json(200, { razao_social: 'X', descricao_identificador_matriz_filial: 'FILIAL' }) }))
    expect(a.ok && a.empresa.tipo).toBe('Filial')
    expect(b.ok && b.empresa.tipo).toBe('Filial')
  })
  it('cai para a próxima fonte quando a primeira bloqueia (403/429/rede)', async () => {
    const f = porHost({ 'brasilapi.com.br': json(403), 'minhareceita.org': new Error('rede'), 'publica.cnpj.ws': json(200, { razao_social: 'PETROBRAS', estabelecimento: { tipo: 'Filial', situacao_cadastral: 'Ativa' } }) })
    const r = await consultaCnpj('33000167000101', f)
    expect(r.ok && [r.empresa.razao_social, r.empresa.tipo, r.empresa.fonte]).toEqual(['PETROBRAS', 'Filial', 'cnpj.ws'])
  })
  it('usa o formato próprio de cada fonte (cnpj.ws e receitaws)', async () => {
    const ws = await consultaCnpj('33000167000101', porHost({ 'publica.cnpj.ws': json(200, { razao_social: 'A', estabelecimento: { tipo: 'Matriz' } }) }))
    const rw = await consultaCnpj('33000167000101', porHost({ 'receitaws.com.br': json(200, { nome: 'B', tipo: 'FILIAL', situacao: 'ATIVA' }) }))
    expect(ws.ok && ws.empresa.tipo).toBe('Matriz')
    expect(rw.ok && [rw.empresa.razao_social, rw.empresa.tipo]).toEqual(['B', 'Filial'])
  })
  it('inválido nem chama a rede', async () => {
    const f = porHost({})
    expect(await consultaCnpj('123', f)).toMatchObject({ ok: false, motivo: 'invalido' })
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
  it('só diz "não encontrado" quando duas fontes concordam; senão tenta as outras', async () => {
    const duas = await consultaCnpj('00000000000191', porHost({ 'brasilapi.com.br': json(404), 'minhareceita.org': json(404) }))
    expect(duas).toMatchObject({ ok: false, motivo: 'nao_encontrado' })
    const uma = await consultaCnpj('00000000000191', porHost({ 'brasilapi.com.br': json(404), 'minhareceita.org': json(200, BB) }))
    expect(uma.ok).toBe(true)
  })
  it('todas indisponíveis: devolve o motivo de cada fonte para diagnóstico', async () => {
    const r = await consultaCnpj('00000000000191', porHost({ 'brasilapi.com.br': json(403), 'minhareceita.org': json(500), 'publica.cnpj.ws': new Error('x'), 'receitaws.com.br': json(200, { status: 'ERROR' }) }))
    expect(r).toMatchObject({ ok: false, motivo: 'indisponivel' })
    expect(!r.ok && r.detalhe).toEqual(['brasilapi: HTTP 403', 'minhareceita: HTTP 500', 'cnpj.ws: Error', 'receitaws: resposta sem razão social'])
  })
})
