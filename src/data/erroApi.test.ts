import { beforeEach, describe, expect, it } from 'vitest'
import { ErroApi, explicarOrigem, falhaDeExcecao, falhaDeResposta, falhasRecentes, limparFalhas, montarRelatorio, registrarFalha, resumirCorpo, type FalhaApi } from './erroApi'

const resposta = (status: number, corpo: string, headers: Record<string, string> = {}) => new Response(corpo, { status, headers })
const falha = (extra: Partial<FalhaApi> = {}): FalhaApi => ({ quando: '2026-11-23T20:00:00.000Z', caminho: '/rows', status: 503, origem: 'radar', req: 'a1b2c3d4', ray: 'ray-GRU', ms: 120, tipoCorpo: 'application/json', corpo: '{"error":"x"}', servidor: 'app;dur=100', ...extra })

beforeEach(() => limparFalhas())

describe('falhaDeResposta: de onde veio o erro', () => {
  it('com x-radar-origem a resposta é do Radar; guarda req, cf-ray, server-timing e o corpo', async () => {
    const f = await falhaDeResposta(
      resposta(503, '{"error":"Banco de dados não configurado."}', { 'x-radar-origem': 'funcao', 'x-radar-req': 'a1b2c3d4', 'cf-ray': '8f2-GRU', 'server-timing': 'app;dur=9', 'content-type': 'application/json' }),
      '/rows',
      performance.now(),
    )
    expect(f).toMatchObject({ status: 503, origem: 'radar', req: 'a1b2c3d4', ray: '8f2-GRU', servidor: 'app;dur=9', caminho: '/rows' })
    expect(f.corpo).toContain('Banco de dados não configurado')
  })

  it('sem x-radar-origem o 503 NÃO veio do Radar (Cloudflare, proxy ou rede)', async () => {
    const f = await falhaDeResposta(resposta(503, '<html><body><h1>Error 1102</h1><p>Worker exceeded resource limits</p></body></html>', { 'content-type': 'text/html', 'cf-ray': 'ray-1' }), '/rows', performance.now())
    expect(f.origem).toBe('fora-do-radar')
    expect(f.req).toBeNull()
    expect(f.corpo).toMatch(/^\[página HTML\] .*Worker exceeded resource limits/)
    expect(f.corpo).not.toContain('<')
  })

  it('erro de rede e tempo esgotado são classificados à parte', () => {
    expect(falhaDeExcecao('/rows', performance.now(), false)).toMatchObject({ origem: 'rede', status: null })
    expect(falhaDeExcecao('/rows', performance.now(), true)).toMatchObject({ origem: 'tempo', status: null })
  })
})

describe('ErroApi', () => {
  it('mantém a mensagem "Falha na API (HTTP n)" que o restante do app reconhece', () => {
    const e = new ErroApi(falha({ status: 503 }))
    expect(e.message).toBe('Falha na API (HTTP 503)')
    expect(/HTTP (404|502|503|504)/.test(e.message)).toBe(true)
    expect(e).toBeInstanceOf(Error)
    expect(e.falha.req).toBe('a1b2c3d4')
  })
})

describe('registro de falhas recentes', () => {
  it('guarda só as 10 últimas, em ordem', () => {
    for (let i = 0; i < 12; i++) registrarFalha(falha({ caminho: `/r${i}` }))
    const r = falhasRecentes()
    expect(r).toHaveLength(10)
    expect(r[0].caminho).toBe('/r2')
    expect(r.at(-1)?.caminho).toBe('/r11')
  })
})

describe('resumirCorpo', () => {
  it('tira quebras de linha, limita a 200 caracteres e ignora vazio', () => {
    expect(resumirCorpo('a\n  b', 'text/plain')).toBe('a b')
    expect(resumirCorpo('x'.repeat(500), null)).toHaveLength(200)
    expect(resumirCorpo('   ', null)).toBeNull()
  })
})

describe('explicarOrigem: diz o que a origem indica', () => {
  it('cada origem tem uma orientação diferente', () => {
    expect(explicarOrigem({ origem: 'radar', status: 503 })).toMatch(/servidor do Radar respondeu/)
    expect(explicarOrigem({ origem: 'fora-do-radar', status: 503 })).toMatch(/NÃO veio do Radar.*Cloudflare.*4G/)
    expect(explicarOrigem({ origem: 'tempo', status: null })).toMatch(/5 segundos/)
    expect(explicarOrigem({ origem: 'rede', status: null })).toMatch(/não recebeu resposta/)
  })
})

describe('montarRelatorio', () => {
  it('reúne contexto, falhas (com origem, req e cf-ray) e o diagnóstico do servidor', () => {
    const t = montarRelatorio({
      falhas: [falha(), falha({ status: null, origem: 'tempo', req: null, ray: null, corpo: null, servidor: null })],
      servidor: { ok: false, checks: [{ nome: 'consulta do painel (/api/rows)', ok: false, erro: 'ECONNRESET' }] },
      agora: '2026-11-23T20:01:00.000Z',
      navegador: 'Chrome/130',
      online: true,
      pagina: 'https://radar-prevendas.pages.dev/',
    })
    expect(t).toContain('Gerado em: 2026-11-23T20:01:00.000Z')
    expect(t).toContain('Navegador: Chrome/130')
    expect(t).toContain('Online: sim')
    expect(t).toContain('FALHAS RECENTES (2)')
    expect(t).toContain('/rows -> 503 | origem: radar | req: a1b2c3d4 | cf-ray: ray-GRU | 120 ms')
    expect(t).toContain('-> sem resposta | origem: tempo')
    expect(t).toContain('server-timing: app;dur=100')
    expect(t).toContain('"erro": "ECONNRESET"')
  })

  it('sem falhas registradas o relatório ainda sai (e diz isso)', () => {
    const t = montarRelatorio({ falhas: [], servidor: { indisponivel: true } })
    expect(t).toContain('FALHAS RECENTES (0)')
    expect(t).toContain('(nenhuma registrada nesta sessão)')
    expect(t).toContain('"indisponivel": true')
  })
})
