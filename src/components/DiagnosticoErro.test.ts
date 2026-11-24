import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/useRows', () => ({ buscarDiagnostico: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

import { ErroApi, limparFalhas, registrarFalha, type FalhaApi } from '@/data/erroApi'
import { DiagnosticoErro } from './DiagnosticoErro'

const falha = (extra: Partial<FalhaApi> = {}): FalhaApi => ({ quando: '2026-11-23T20:00:00.000Z', caminho: '/rows', status: 503, origem: 'fora-do-radar', req: null, ray: '8f2abc-GRU', ms: 310, tipoCorpo: 'text/html', corpo: '[página HTML] Error 1102 Worker exceeded resource limits', servidor: null, ...extra })
const html = (error: unknown) => renderToStaticMarkup(createElement(DiagnosticoErro, { error }))

beforeEach(() => limparFalhas())

describe('DiagnosticoErro', () => {
  it('mostra origem, status, cf-ray, tempo, trecho da resposta e a orientação para erro vindo de fora do Radar', () => {
    const h = html(new ErroApi(falha()))
    expect(h).toContain('Detalhes técnicos para o suporte')
    expect(h).toContain('NÃO veio do Radar')
    expect(h).toContain('/rows')
    expect(h).toContain('503')
    expect(h).toContain('fora-do-radar')
    expect(h).toContain('8f2abc-GRU')
    expect(h).toContain('310 ms')
    expect(h).toContain('Worker exceeded resource limits')
    expect(h).toContain('Copiar diagnóstico completo')
  })

  it('erro embrulhado em cause (como o da carga do painel) também é encontrado; mostra o código da requisição do Radar', () => {
    const erro = new Error('API indisponível. Falha na API (HTTP 503)', { cause: new ErroApi(falha({ origem: 'radar', req: 'a1b2c3d4', ray: null })) })
    const h = html(erro)
    expect(h).toContain('a1b2c3d4')
    expect(h).toContain('servidor do Radar respondeu')
  })

  it('sem ErroApi usa a última falha registrada; sem nenhuma, diz que foi erro de processamento dos dados', () => {
    registrarFalha(falha({ caminho: '/status', status: null, origem: 'rede', ray: null, corpo: null }))
    expect(html(new Error('x'))).toContain('/status')
    limparFalhas()
    expect(html(new Error('Formato de dados inesperado'))).toContain('veio do processamento dos dados')
  })

  it('escapa o texto vindo do servidor (nada de HTML injetado a partir da resposta)', () => {
    const h = html(new ErroApi(falha({ corpo: '<img src=x onerror=alert(1)>' })))
    expect(h).not.toContain('<img')
    expect(h).toContain('&lt;img')
  })
})
